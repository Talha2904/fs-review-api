import { isSlot, MAX_BYTES, type PermissionMatrix } from '@fs-review/shared';

import { notFound, validationFailed } from '../../domain/errors.js';
import type { Actor } from '../../domain/identity/User.js';
import {
  contentKey,
  contentTypeFor,
  currentVersion,
  uploadProblem,
  viewOf,
  type DocumentVersion,
  type DocumentVersionView,
  type Person,
  type Validation
} from '../../domain/review/Document.js';
import type { Clock } from '../ports/Clock.js';
import type { DocumentRepository } from '../ports/DocumentRepository.js';
import type { EventBus } from '../ports/EventBus.js';
import type { FileStorage } from '../ports/FileStorage.js';
import type { IdGenerator } from '../ports/IdGenerator.js';
import type { PointRepository } from '../ports/PointRepository.js';
import type { Tokens } from '../ports/Tokens.js';

import type { ReviewAccess } from './access.js';

const who = (a: Actor): Person => ({ id: a.id, name: a.name, role: a.role });

export interface AttachResult {
  version: DocumentVersionView;
  /** True when the content matched the current version, so nothing was stored or changed. */
  unchanged: boolean;
}

/**
 * Attaches an upload as the next version of its slot. The same content as the current version makes
 * no new version; content matching an older version is recorded as "same content as vN".
 */
export class AttachDocument {
  constructor(
    private readonly access: ReviewAccess,
    private readonly documents: DocumentRepository,
    private readonly points: PointRepository,
    private readonly storage: FileStorage,
    private readonly tokens: Tokens,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly events: EventBus
  ) {}

  async execute(
    actor: Actor | null,
    matrix: PermissionMatrix,
    engagementId: string,
    slot: unknown,
    fileName: string,
    bytes: Uint8Array,
    opts: { responseTo?: string } = {}
  ): Promise<AttachResult> {
    // A revised document on a response to an open point is the one upload allowed while the documents are marked ready.
    const by = opts.responseTo
      ? await this.access.documentWriter(actor, matrix, engagementId, ['points.respond'], { whileReady: true })
      : await this.access.documentWriter(actor, matrix, engagementId, ['documents.attach']);
    if (opts.responseTo) {
      const point = await this.points.findById(opts.responseTo);
      if (!point || point.engagementId !== engagementId) throw validationFailed('That review point was not found on this fund.');
      if (!['open', 'reopened'].includes(point.status))
        throw validationFailed('A revised document can only go with a response to an open point.');
    }
    if (!isSlot(slot)) throw validationFailed('Unknown document slot.');
    const problem = uploadProblem(slot, fileName, bytes, MAX_BYTES);
    if (problem) throw validationFailed(problem);
    const sha256 = this.tokens.fingerprintBytes(bytes);
    const all = await this.documents.listByEngagement(engagementId);
    const cur = currentVersion(all, slot);
    if (cur && contentKey(cur) === sha256) return { version: viewOf(cur), unchanged: true };
    const earlier = [...all].reverse().find((v) => v.slot === slot && contentKey(v) === sha256);
    const id = this.ids.next();
    const storageKey = earlier?.storageKey ?? `engagements/${engagementId}/documents/${id}`;
    const stored = !earlier?.storageKey;
    if (stored) await this.storage.put(storageKey, bytes, contentTypeFor(slot));
    const now = this.clock.nowIso();
    const rec: DocumentVersion = {
      id,
      engagementId,
      slot,
      version: all.filter((v) => v.slot === slot).length + 1,
      fileName,
      size: bytes.length,
      sha256,
      sample: false,
      storageKey,
      uploadedBy: who(by),
      uploadedAt: now,
      removedAt: null,
      removedBy: null,
      validation: { status: 'checking', summary: 'Checking…', checks: [] },
      confirmation: null,
      readWith: null,
      readWithBy: null,
      readWithAt: null,
      sameAs: earlier?.version ?? null
    };
    try {
      await this.documents.create(rec);
    } catch (e) {
      if (stored) await this.storage.delete(storageKey).catch(() => undefined); // no orphaned file
      throw e;
    }
    await this.events.publish({ topic: 'document_versions', engagementId, at: now });
    return { version: viewOf(rec), unchanged: false };
  }
}

/** Attaches a built-in sample document (no file) as the next version of its slot. */
export class AttachSampleDocument {
  constructor(
    private readonly access: ReviewAccess,
    private readonly documents: DocumentRepository,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly events: EventBus
  ) {}

  async execute(
    actor: Actor | null,
    matrix: PermissionMatrix,
    engagementId: string,
    slot: unknown,
    sampleName: string
  ): Promise<AttachResult> {
    const by = await this.access.documentWriter(actor, matrix, engagementId, ['documents.attach']);
    if (!isSlot(slot)) throw validationFailed('Unknown document slot.');
    const name = String(sampleName || '').trim();
    if (!name) throw validationFailed('Which sample document?');
    const all = await this.documents.listByEngagement(engagementId);
    const cur = currentVersion(all, slot);
    if (cur && contentKey(cur) === 'sample:' + name) return { version: viewOf(cur), unchanged: true };
    const now = this.clock.nowIso();
    const rec: DocumentVersion = {
      id: this.ids.next(),
      engagementId,
      slot,
      version: all.filter((v) => v.slot === slot).length + 1,
      fileName: name,
      size: 0,
      sha256: '',
      sample: true,
      storageKey: null,
      uploadedBy: who(by),
      uploadedAt: now,
      removedAt: null,
      removedBy: null,
      validation: { status: 'sample', summary: 'Built-in sample document', checks: [], checkedAt: now },
      confirmation: null,
      readWith: null,
      readWithBy: null,
      readWithAt: null,
      sameAs: null
    };
    await this.documents.create(rec);
    await this.events.publish({ topic: 'document_versions', engagementId, at: now });
    return { version: viewOf(rec), unchanged: false };
  }
}

/** Stores the recognition result the web app worked out for a version (no AI). */
export class SetDocumentValidation {
  constructor(
    private readonly access: ReviewAccess,
    private readonly documents: DocumentRepository,
    private readonly clock: Clock,
    private readonly events: EventBus
  ) {}
  async execute(actor: Actor | null, matrix: PermissionMatrix, versionId: string, validation: Validation): Promise<DocumentVersionView> {
    const v = await this.documents.findById(versionId);
    if (!v) throw notFound('That document version');
    await this.access.versionWriter(actor, matrix, v, ['documents.attach', 'analysis.run']);
    if (v.sample) throw validationFailed('A built-in sample is not checked.');
    const next = { ...v, validation: { ...validation, checkedAt: this.clock.nowIso() } };
    if (!(await this.documents.patch(v.id, { validation: next.validation }))) throw validationFailed('That version was removed.');
    await this.events.publish({ topic: 'document_versions', engagementId: v.engagementId, at: this.clock.nowIso() });
    return viewOf(next);
  }
}

/** How a document is read: 'ai' when a person chose AI over a low-confidence OCR reading. */
export class SetDocumentReadWith {
  constructor(
    private readonly access: ReviewAccess,
    private readonly documents: DocumentRepository,
    private readonly clock: Clock,
    private readonly events: EventBus
  ) {}
  async execute(actor: Actor | null, matrix: PermissionMatrix, versionId: string, mode: string): Promise<DocumentVersionView> {
    const v = await this.documents.findById(versionId);
    if (!v) throw notFound('That document version');
    const by = await this.access.versionWriter(actor, matrix, v, ['documents.attach', 'analysis.run']);
    if (!['ai', 'ocr', 'local'].includes(mode)) throw validationFailed('Unknown reading mode.');
    const now = this.clock.nowIso();
    const next = { ...v, readWith: mode, readWithBy: who(by), readWithAt: now };
    if (!(await this.documents.patch(v.id, { readWith: mode, readWithBy: who(by), readWithAt: now })))
      throw validationFailed('That version was removed.');
    await this.events.publish({ topic: 'document_versions', engagementId: v.engagementId, at: now });
    return viewOf(next);
  }
}

/** Confirm Anyway: a person accepts a version that needs a check or mismatched, with a reason for a mismatch. */
export class ConfirmDocument {
  constructor(
    private readonly access: ReviewAccess,
    private readonly documents: DocumentRepository,
    private readonly clock: Clock,
    private readonly events: EventBus
  ) {}
  async execute(actor: Actor | null, matrix: PermissionMatrix, versionId: string, reason: string): Promise<DocumentVersionView> {
    const v = await this.documents.findById(versionId);
    if (!v) throw notFound('That document version');
    const by = await this.access.versionWriter(actor, matrix, v, ['documents.attach', 'analysis.run']);
    if (v.validation?.status === 'mismatch' && !String(reason || '').trim())
      throw validationFailed('Give the reason for confirming a mismatched document.');
    const now = this.clock.nowIso();
    const next = { ...v, confirmation: { by: who(by), at: now, reason: String(reason || '').trim() } };
    if (!(await this.documents.patch(v.id, { confirmation: next.confirmation }))) throw validationFailed('That version was removed.');
    await this.events.publish({ topic: 'document_versions', engagementId: v.engagementId, at: now });
    return viewOf(next);
  }
}

/** Removes the current version of a slot; the version stays on record. */
export class RemoveDocument {
  constructor(
    private readonly access: ReviewAccess,
    private readonly documents: DocumentRepository,
    private readonly clock: Clock,
    private readonly events: EventBus
  ) {}
  async execute(actor: Actor | null, matrix: PermissionMatrix, engagementId: string, slot: unknown): Promise<void> {
    const by = await this.access.documentWriter(actor, matrix, engagementId, ['documents.attach']);
    if (!isSlot(slot)) throw validationFailed('Unknown document slot.');
    const cur = currentVersion(await this.documents.listByEngagement(engagementId), slot);
    if (!cur) return;
    const now = this.clock.nowIso();
    if (!(await this.documents.markRemoved(cur.id, who(by), now))) return; // removed by someone else at the same moment
    await this.events.publish({ topic: 'document_versions', engagementId, at: now });
  }
}

/** The bytes of a version, for the web app to read and analyse. */
export class DownloadDocument {
  constructor(
    private readonly access: ReviewAccess,
    private readonly documents: DocumentRepository,
    private readonly storage: FileStorage
  ) {}
  async execute(
    actor: Actor | null,
    matrix: PermissionMatrix,
    versionId: string
  ): Promise<{ fileName: string; contentType: string; bytes: Uint8Array }> {
    const v = await this.documents.findById(versionId);
    if (!v || !v.storageKey) throw notFound('That document');
    await this.access.reader(actor, matrix, v.engagementId);
    const f = await this.storage.get(v.storageKey);
    if (!f) throw notFound('That document’s file');
    return { fileName: v.fileName, contentType: f.contentType, bytes: f.bytes };
  }
}
