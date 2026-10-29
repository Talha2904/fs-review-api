import { canClearPoint, nextPointStatus, type PermissionMatrix, type PointAction } from '@fs-review/shared';

import { forbidden, notFound, validationFailed } from '../../domain/errors.js';
import type { Actor } from '../../domain/identity/User.js';
import type { Person } from '../../domain/review/Document.js';
import {
  EVIDENCE_EXT,
  EVIDENCE_MAX_BYTES,
  nextRef,
  POINT_TYPES,
  TYPE_LABEL,
  typeFor,
  type Attachment,
  type MessageKind,
  type PointContent,
  type PointEvidence,
  type PointType,
  type ReviewPoint
} from '../../domain/review/Point.js';
import type { Clock } from '../ports/Clock.js';
import type { DocumentRepository } from '../ports/DocumentRepository.js';
import type { EventBus } from '../ports/EventBus.js';
import type { FileStorage } from '../ports/FileStorage.js';
import type { IdGenerator } from '../ports/IdGenerator.js';
import type { EvidenceRepository, PointMessageRepository, PointRepository } from '../ports/PointRepository.js';
import type { Tokens } from '../ports/Tokens.js';
import type { UserRepository } from '../ports/UserRepository.js';

import type { ReviewAccess } from './access.js';

const who = (a: Actor): Person => ({ id: a.id, name: a.name, role: a.role });

/** The pieces every point use case shares: find the point, check access, append to its thread, publish. */
class PointBase {
  constructor(
    protected readonly access: ReviewAccess,
    protected readonly points: PointRepository,
    protected readonly messages: PointMessageRepository,
    protected readonly ids: IdGenerator,
    protected readonly clock: Clock,
    protected readonly events: EventBus,
    protected readonly users?: UserRepository
  ) {}

  /** An assignee must be an active member of the review staff; the name is taken from the account, not the request. */
  protected async assignee(a: Person | null): Promise<Person | null> {
    if (!a || !this.users) return a;
    const u = await this.users.findById(a.id);
    if (!u || !u.active || u.role === 'Finance') throw validationFailed('Assign the point to an active member of the review team.');
    return { id: u.id, name: u.name, role: u.role };
  }

  protected async point(pointId: string): Promise<ReviewPoint> {
    const p = await this.points.findById(pointId);
    if (!p) throw notFound('That review point');
    return p;
  }

  protected async say(
    p: ReviewPoint,
    kind: MessageKind,
    author: Person | null,
    text: string,
    attachments: Attachment[] = []
  ): Promise<void> {
    await this.messages.create({
      id: this.ids.next(),
      pointId: p.id,
      engagementId: p.engagementId,
      kind,
      author,
      at: this.clock.nowIso(),
      text: text || '',
      attachments
    });
  }

  protected async changed(engagementId: string): Promise<void> {
    await this.events.publish({ topic: 'review_points', engagementId, at: this.clock.nowIso() });
  }
}

/** A manual point from the Analysis tab or a disclosure "No". The reference is made here so it is never reused. */
export class RaisePoint extends PointBase {
  async execute(
    actor: Actor | null,
    matrix: PermissionMatrix,
    engagementId: string,
    content: PointContent,
    requested: Person | null
  ): Promise<ReviewPoint> {
    const by = await this.access.writer(actor, matrix, engagementId, ['points.raise']);
    const assignee = await this.assignee(requested);
    if (!content || !String(content.title || '').trim()) throw validationFailed('Give the point a title.');
    const existing = (await this.points.listByEngagement(engagementId)).map((p) => p.ref);
    const prefix = String(content.ref || 'RP-').replace(/\d+$/, '') || 'RP-';
    const ref = existing.includes(String(content.ref)) || !content.ref ? nextRef(prefix, existing) : String(content.ref);
    const now = this.clock.nowIso();
    const rec: ReviewPoint = {
      id: this.ids.next(),
      engagementId,
      ref,
      source: 'manual',
      content: { ...content, ref },
      status: 'open',
      type: typeFor(content),
      dueDate: null,
      assignedTo: assignee,
      raisedBy: who(by),
      raisedAt: now,
      clearedBy: null,
      clearedAt: null,
      updatedAt: now
    };
    await this.points.create(rec);
    await this.say(rec, 'raise', who(by), `Raised by ${by.name}.`);
    if (assignee) await this.say(rec, 'assign', who(by), `Assigned to ${assignee.name}.`);
    await this.changed(engagementId);
    return rec;
  }
}

/** Type (change, explain, info) and due date, set by whoever may raise points; noted in the thread. */
export class SetPointMeta extends PointBase {
  async execute(
    actor: Actor | null,
    matrix: PermissionMatrix,
    pointId: string,
    patch: { type?: string; dueDate?: string | null }
  ): Promise<ReviewPoint> {
    const p = await this.point(pointId);
    const by = await this.access.writer(actor, matrix, p.engagementId, ['points.raise']);
    const notes: string[] = [];
    let next = { ...p };
    if (patch.type !== undefined) {
      if (!POINT_TYPES.includes(patch.type as PointType)) throw validationFailed('Choose a point type.');
      if (patch.type !== p.type) {
        next = { ...next, type: patch.type as PointType };
        notes.push(`Type set to ${TYPE_LABEL[patch.type as PointType]}.`);
      }
    }
    if (patch.dueDate !== undefined) {
      const d = patch.dueDate || null;
      if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw validationFailed('Enter the due date as a date.');
      if (d !== (p.dueDate || null)) {
        next = { ...next, dueDate: d };
        notes.push(d ? `Due date set to ${d}.` : 'Due date removed.');
      }
    }
    if (!notes.length) return p;
    next.updatedAt = this.clock.nowIso();
    await this.points.update(next, p.updatedAt);
    await this.say(p, 'assign', who(by), notes.join(' '));
    await this.changed(p.engagementId);
    return next;
  }
}

export class AssignPoint extends PointBase {
  async execute(actor: Actor | null, matrix: PermissionMatrix, pointId: string, requested: Person | null): Promise<ReviewPoint> {
    const p = await this.point(pointId);
    const by = await this.access.writer(actor, matrix, p.engagementId, ['points.raise']);
    const assignee = await this.assignee(requested);
    const next = { ...p, assignedTo: assignee, updatedAt: this.clock.nowIso() };
    await this.points.update(next, p.updatedAt);
    await this.say(p, 'assign', who(by), assignee ? `Assigned to ${assignee.name}.` : 'Unassigned.');
    await this.changed(p.engagementId);
    return next;
  }
}

/** Anyone involved may comment: whoever can raise, respond or clear. */
export class CommentOnPoint extends PointBase {
  async execute(actor: Actor | null, matrix: PermissionMatrix, pointId: string, text: string): Promise<void> {
    const p = await this.point(pointId);
    const by = await this.access.writer(actor, matrix, p.engagementId, [
      'points.raise',
      'points.respond',
      'points.clear',
      'points.clearAny'
    ]);
    if (!String(text || '').trim()) throw validationFailed('Write the comment first.');
    await this.say(p, 'comment', who(by), String(text).trim());
    await this.points.touch(p.id, this.clock.nowIso());
    await this.changed(p.engagementId);
  }
}

/**
 * The status cycle. A response (points.respond) may carry a revised document version and evidence.
 * Reopen and clear follow the matrix: the raiser if their role may clear their own points, or anyone who may clear any.
 */
export class ActOnPoint extends PointBase {
  constructor(
    access: ReviewAccess,
    points: PointRepository,
    messages: PointMessageRepository,
    ids: IdGenerator,
    clock: Clock,
    events: EventBus,
    private readonly documents: DocumentRepository,
    private readonly evidence: EvidenceRepository
  ) {
    super(access, points, messages, ids, clock, events);
  }

  /** A response may carry versions of this fund's documents and evidence filed on this point, nothing else. */
  private async checkedAttachments(p: ReviewPoint, kind: PointAction, list: Attachment[]): Promise<Attachment[]> {
    if (!list.length) return [];
    if (kind !== 'response') throw validationFailed('Only a response carries attachments.');
    const out: Attachment[] = [];
    for (const a of list) {
      if (a.type === 'version') {
        const v = await this.documents.findById(String(a.versionId));
        if (!v || v.engagementId !== p.engagementId)
          throw validationFailed('A revised document on this response was not found on this fund.');
        out.push({ type: 'version', slot: v.slot, versionId: v.id, version: v.version, fileName: v.fileName });
      } else if (a.type === 'evidence') {
        const e = await this.evidence.findById(String(a.id));
        if (!e || e.pointId !== p.id) throw validationFailed('An evidence file on this response was not filed on this point.');
        out.push({ type: 'evidence', id: e.id, fileName: e.fileName, size: e.size });
      } else throw validationFailed('Unknown attachment.');
    }
    return out;
  }

  async execute(
    actor: Actor | null,
    matrix: PermissionMatrix,
    pointId: string,
    kind: PointAction,
    text: string,
    attachments: Attachment[] = []
  ): Promise<ReviewPoint> {
    const p = await this.point(pointId);
    let by: Actor;
    if (kind === 'response') by = await this.access.writer(actor, matrix, p.engagementId, ['points.respond']);
    else {
      by = await this.access.writer(actor, matrix, p.engagementId, ['points.clear', 'points.clearAny']);
      if (!canClearPoint(by, p, matrix))
        throw forbidden('Only the person who raised this point, or a role that may clear any point, can clear or reopen it.');
      if (kind === 'reopen' && !String(text || '').trim()) throw validationFailed('Give the reason for reopening the point.');
    }
    const status = nextPointStatus(p.status, kind);
    if (!status)
      throw validationFailed(
        `A ${p.status} point cannot be ${kind === 'response' ? 'responded to' : kind === 'reopen' ? 'reopened' : 'cleared'}.`
      );
    const now = this.clock.nowIso();
    const next: ReviewPoint = {
      ...p,
      status,
      updatedAt: now,
      clearedBy: status === 'cleared' ? who(by) : null,
      clearedAt: status === 'cleared' ? now : null
    };
    const checked = await this.checkedAttachments(p, kind, attachments);
    await this.points.update(next, p.updatedAt);
    await this.say(p, kind, who(by), String(text || ''), checked);
    await this.changed(p.engagementId);
    return next;
  }
}

/** A supporting file kept with a point and downloadable from its thread. */
export class AddEvidence {
  constructor(
    private readonly access: ReviewAccess,
    private readonly points: PointRepository,
    private readonly evidence: EvidenceRepository,
    private readonly storage: FileStorage,
    private readonly tokens: Tokens,
    private readonly ids: IdGenerator,
    private readonly clock: Clock
  ) {}
  async execute(
    actor: Actor | null,
    matrix: PermissionMatrix,
    pointId: string,
    fileName: string,
    bytes: Uint8Array
  ): Promise<Omit<PointEvidence, 'storageKey'>> {
    const p = await this.points.findById(pointId);
    if (!p) throw notFound('That review point');
    const by = await this.access.writer(actor, matrix, p.engagementId, ['points.respond']);
    if (!EVIDENCE_EXT.test(fileName))
      throw validationFailed(`“${fileName}” isn’t a supported evidence file (PDF, Excel, CSV, Word, image, email or text).`);
    if (!bytes.length) throw validationFailed(`“${fileName}” is empty.`);
    if (bytes.length > EVIDENCE_MAX_BYTES) throw validationFailed(`“${fileName}” is larger than 25 MB.`);
    const id = this.ids.next();
    const storageKey = `engagements/${p.engagementId}/evidence/${id}`;
    await this.storage.put(storageKey, bytes, 'application/octet-stream');
    const rec: PointEvidence = {
      id,
      engagementId: p.engagementId,
      pointId,
      fileName,
      size: bytes.length,
      sha256: this.tokens.fingerprintBytes(bytes),
      storageKey,
      by: who(by),
      at: this.clock.nowIso()
    };
    await this.evidence.create(rec);
    const { storageKey: _k, ...view } = rec;
    return view;
  }
}

export class DownloadEvidence {
  constructor(
    private readonly access: ReviewAccess,
    private readonly evidence: EvidenceRepository,
    private readonly storage: FileStorage
  ) {}
  async execute(actor: Actor | null, matrix: PermissionMatrix, id: string): Promise<{ fileName: string; bytes: Uint8Array }> {
    const e = await this.evidence.findById(id);
    if (!e) throw notFound('That evidence file');
    await this.access.reader(actor, matrix, e.engagementId);
    const f = await this.storage.get(e.storageKey);
    if (!f) throw notFound('That evidence file');
    return { fileName: e.fileName, bytes: f.bytes };
  }
}
