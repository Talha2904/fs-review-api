import { isLockedSignoff, type PermissionMatrix } from '@fs-review/shared';

import { conflict, locked, validationFailed } from '../../domain/errors.js';
import type { Actor } from '../../domain/identity/User.js';
import { engagementIndex, engagementProblem, type EngagementDocument } from '../../domain/review/Engagement.js';
import { requireAnyPermission, requirePermission } from '../identity/authorize.js';
import type { Clock } from '../ports/Clock.js';
import type { EngagementRepository } from '../ports/EngagementRepository.js';
import type { EntityRepository } from '../ports/EntityRepository.js';
import type { IdGenerator } from '../ports/IdGenerator.js';
import type { SignoffRepository } from '../ports/SignoffRepository.js';

const ID_RE = /^[A-Za-z0-9._-]{3,64}$/;

export class ListEngagements {
  constructor(private readonly engagements: EngagementRepository) {}
  async execute(actor: Actor | null, matrix: PermissionMatrix): Promise<EngagementDocument[]> {
    requirePermission(actor, 'activity.write', matrix);
    return (await this.engagements.list()).map((r) => r.doc);
  }
}

/**
 * Creates or updates a fund engagement. Setting up an engagement needs engagements.edit; saving only the
 * trial balance mapping is allowed for anyone who attaches documents or runs the analysis, as before.
 */
export class SaveEngagement {
  constructor(
    private readonly engagements: EngagementRepository,
    private readonly entities: EntityRepository,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly signoffs: SignoffRepository
  ) {}

  async execute(
    actor: Actor | null,
    matrix: PermissionMatrix,
    input: Partial<EngagementDocument>,
    idFromPath?: string
  ): Promise<EngagementDocument> {
    const id = idFromPath || (typeof input.id === 'string' ? input.id : '') || this.ids.next();
    if (!ID_RE.test(id)) throw validationFailed('The engagement id is not valid.');
    const existing = await this.engagements.findById(id);
    // settings, team and trial balance mapping of a signed-off review cannot change until it is unlocked
    if (existing && isLockedSignoff((await this.signoffs.get(id))?.state ?? 'none')) throw locked();
    const doc: EngagementDocument = {
      ...(existing?.doc ?? {}),
      ...input,
      id,
      fund: { ...(existing?.doc.fund ?? {}), ...(input.fund ?? {}) }
    } as EngagementDocument;
    const onlyMapping = !!existing && isMappingOnlyChange(existing.doc, doc);
    const by = onlyMapping
      ? requireAnyPermission(actor, ['engagements.edit', 'documents.attach', 'analysis.run'], matrix)
      : requirePermission(actor, 'engagements.edit', matrix);
    const problem = engagementProblem(doc);
    if (problem) throw validationFailed(problem);
    if (doc.entityId && !(await this.entities.findById(doc.entityId))) throw validationFailed('That entity no longer exists.');
    const ix = engagementIndex(doc);
    const dup = await this.engagements.findDuplicate(ix.entityId, ix.fundName, ix.yearEnd, id);
    if (dup) throw conflict(`${ix.fundName} for the year ended ${ix.yearEnd} already exists under that entity.`);
    const now = this.clock.nowIso();
    if (existing) {
      const updated = {
        doc: { ...doc, createdAt: existing.doc.createdAt ?? existing.createdAt, savedAt: now },
        createdBy: existing.createdBy,
        createdAt: existing.createdAt,
        updatedBy: by.id,
        updatedAt: now
      };
      await this.engagements.update(updated);
      return updated.doc;
    }
    const created = {
      doc: { ...doc, createdAt: doc.createdAt ?? now, savedAt: now },
      createdBy: by.id,
      createdAt: now,
      updatedBy: by.id,
      updatedAt: now
    };
    await this.engagements.create(created);
    return created.doc;
  }
}

/** True when the only fields that differ are the trial balance mapping and its stamp. */
function isMappingOnlyChange(before: EngagementDocument, after: EngagementDocument): boolean {
  const strip = (d: EngagementDocument) => {
    const { tbMap: _m, tbMapBy: _b, tbMapAt: _a, savedAt: _s, ...rest } = d;
    return JSON.stringify(rest);
  };
  return strip(before) === strip(after) && JSON.stringify(before.tbMap ?? null) !== JSON.stringify(after.tbMap ?? null);
}
