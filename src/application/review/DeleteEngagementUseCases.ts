// Deleting a fund is a soft delete: the engagement is marked deleted (who, when, why) and every part of its review
// is kept as it is, but the fund is no longer found anywhere in the app: its id answers 404, it leaves the lists,
// the portfolio, the bell, its Consolidated Review group and its shared points, and no analysis of it runs. Billing
// is not changed (its AI usage stays billable). Restoring it brings everything back as it was.
import { isLockedSignoff, type PermissionMatrix } from '@fs-review/shared';

import { conflict, notFound, validationFailed } from '../../domain/errors.js';
import type { Actor } from '../../domain/identity/User.js';
import type { Person } from '../../domain/review/Document.js';
import { engagementIndex } from '../../domain/review/Engagement.js';
import type { ActivityRecorder } from '../activity/ActivityRecorder.js';
import { requirePermission } from '../identity/authorize.js';
import { isActiveJob, type AnalysisJobRepository } from '../ports/AnalysisJobRepository.js';
import type { Clock } from '../ports/Clock.js';
import { isActiveConsolidation, type ConsolidatedReviewRepository } from '../ports/ConsolidatedReviewRepository.js';
import type { EngagementRecord, EngagementRepository } from '../ports/EngagementRepository.js';
import type { EntityRepository } from '../ports/EntityRepository.js';
import type { EventBus } from '../ports/EventBus.js';
import type { IdGenerator } from '../ports/IdGenerator.js';
import type { PointRepository } from '../ports/PointRepository.js';
import type { SignoffRepository } from '../ports/SignoffRepository.js';

import { loadGroups } from './ConsolidatedReviewUseCases.js';

/** The longest reason kept with a deletion. */
export const DELETE_REASON_MAX = 500;
/** The live-update topic for the list of funds (a delete or a restore). */
const TOPIC = 'engagements';

const who = (a: Actor): Person => ({ id: a.id, name: a.name, role: a.role });
/** Names compared as a person types them: case and repeated spaces do not matter. */
const sameName = (a: string, b: string) => a.trim().replace(/\s+/g, ' ').toLowerCase() === b.trim().replace(/\s+/g, ' ').toLowerCase();

export interface DeletedFund {
  id: string;
  fundName: string;
  yearEnd: string;
  entityId: string | null;
  entityName: string;
  clientName: string;
  deletedAt: string;
  deletedBy: Person | null;
  reason: string | null;
}

interface Deps {
  engagements: EngagementRepository;
  entities: EntityRepository;
  jobs: AnalysisJobRepository;
  consolidated: ConsolidatedReviewRepository;
  activity: ActivityRecorder;
  clock: Clock;
  events: EventBus;
  points: PointRepository;
  signoffs: SignoffRepository;
  ids: IdGenerator;
}

const describe = (rec: EngagementRecord) => {
  const ix = engagementIndex(rec.doc);
  return { name: ix.fundName || 'Untitled fund', yearEnd: ix.yearEnd };
};

/** Deletes a fund (soft). Needs engagements.delete, the fund's name typed to confirm, and nothing of it running. */
export class DeleteEngagement {
  constructor(private readonly d: Deps) {}

  async execute(
    actor: Actor | null,
    matrix: PermissionMatrix,
    engagementId: string,
    input: { confirmName: string; reason?: string | null },
    ip?: string
  ): Promise<{ id: string; deletedAt: string }> {
    const by = requirePermission(actor, 'engagements.delete', matrix);
    const rec = await this.d.engagements.findById(engagementId);
    if (!rec) throw notFound('That engagement');
    const { name, yearEnd } = describe(rec);
    if (!sameName(String(input.confirmName ?? ''), name)) throw validationFailed(`Type the fund’s name, ${name}, to confirm.`);
    const reason = String(input.reason ?? '').trim() || null;
    if (reason && reason.length > DELETE_REASON_MAX) throw validationFailed(`Keep the reason to ${DELETE_REASON_MAX} characters.`);

    // a running analysis or Consolidated Review would save into a fund nobody can see
    if (isActiveJob(await this.d.jobs.latest(engagementId)))
      throw conflict('An analysis of this fund is running. Wait for it to finish, then delete the fund.');
    const group = (await loadGroups(this.d.engagements, this.d.entities)).find((g) => g.funds.some((f) => f.engagementId === engagementId));
    if (group && isActiveConsolidation(await this.d.consolidated.latest(group.groupKey, group.yearEnd)))
      throw conflict(`A Consolidated Review of ${group.groupName} is running. Wait for it to finish, then delete the fund.`);

    const at = this.d.clock.nowIso();
    if (!(await this.d.engagements.markDeleted(engagementId, { at, by: who(by), reason }))) throw notFound('That engagement');
    await this.d.activity.record({
      actor: by,
      category: 'Engagements',
      summary: `Deleted fund ${name}`,
      details: [`Year end ${yearEnd}`, reason ? `Reason: ${reason}` : 'No reason given', 'It can be restored from Deleted funds.'].join(
        ' · '
      ),
      ip: ip ?? '',
      engagementId,
      fundName: name
    });
    await this.d.events.publish({ topic: TOPIC, engagementId, at });
    return { id: engagementId, deletedAt: at };
  }
}

/** Brings a deleted fund back with everything it had, unless a live fund now has the same entity, name and year end. */
export class RestoreEngagement {
  constructor(private readonly d: Deps) {}

  async execute(actor: Actor | null, matrix: PermissionMatrix, engagementId: string, ip?: string): Promise<{ id: string }> {
    const by = requirePermission(actor, 'engagements.delete', matrix);
    const rec = await this.d.engagements.findIncludingDeleted(engagementId);
    if (!rec?.deleted) throw notFound('That deleted fund');
    const { name, yearEnd } = describe(rec);
    const ix = engagementIndex(rec.doc);
    if (ix.entityId && !(await this.d.entities.findById(ix.entityId))) throw validationFailed('The fund’s entity no longer exists.');
    if (await this.d.engagements.findDuplicate(ix.entityId, ix.fundName, ix.yearEnd, engagementId))
      throw conflict(`${name} for the year ended ${yearEnd} already exists under that entity. Rename or delete that fund first.`);
    const at = this.d.clock.nowIso();
    if (!(await this.d.engagements.restore(engagementId, by.id, at))) throw notFound('That deleted fund');
    await this.d.activity.record({
      actor: by,
      category: 'Engagements',
      summary: `Restored fund ${name}`,
      details: `Year end ${yearEnd} · deleted ${rec.deleted.at.slice(0, 10)}${rec.deleted.by ? ` by ${rec.deleted.by.name}` : ''}`,
      ip: ip ?? '',
      engagementId,
      fundName: name
    });
    await this.unshareAlone(engagementId, by, at);
    await this.d.events.publish({ topic: TOPIC, engagementId, at });
    return { id: engagementId };
  }

  /**
   * A shared point whose other copies stopped sharing while this fund was deleted is an ordinary point again, as when
   * the other fund stops sharing (UnsharePoint), unless this fund is signed off: then it stays as it is.
   */
  private async unshareAlone(engagementId: string, by: Actor, at: string) {
    const own = (await this.d.points.listByEngagement(engagementId)).filter((p) => p.sharedGroupId);
    if (!own.length || isLockedSignoff((await this.d.signoffs.get(engagementId))?.state ?? 'none')) return;
    const copies = await this.d.points.listBySharedGroups([...new Set(own.map((p) => p.sharedGroupId!))]);
    const alone = own.filter((p) => !copies.some((q) => q.sharedGroupId === p.sharedGroupId && q.engagementId !== engagementId));
    if (!alone.length) return;
    await this.d.points.saveShared({
      create: [],
      update: alone.map((p) => ({ point: { ...p, sharedGroupId: null, updatedAt: at }, expectedUpdatedAt: p.updatedAt })),
      messages: alone.map((p) => ({
        id: this.d.ids.next(),
        pointId: p.id,
        engagementId,
        kind: 'note',
        author: who(by),
        at,
        text: 'No longer shared: the other funds stopped sharing this point while this fund was deleted.',
        attachments: []
      }))
    });
    await this.d.events.publish({ topic: 'review_points', engagementId, at });
  }
}

/** The deleted funds, most recently deleted first, for whoever may restore them. */
export class ListDeletedEngagements {
  constructor(
    private readonly engagements: EngagementRepository,
    private readonly entities: EntityRepository
  ) {}

  async execute(actor: Actor | null, matrix: PermissionMatrix): Promise<DeletedFund[]> {
    requirePermission(actor, 'engagements.delete', matrix);
    const [deleted, entities] = await Promise.all([this.engagements.listDeleted(), this.entities.list()]);
    const entity = new Map(entities.map((e) => [e.doc.id, e.doc]));
    return deleted.map((rec) => {
      const ix = engagementIndex(rec.doc);
      const ent = ix.entityId ? entity.get(ix.entityId) : undefined;
      return {
        id: rec.doc.id,
        fundName: ix.fundName || 'Untitled fund',
        yearEnd: ix.yearEnd,
        entityId: ix.entityId,
        entityName: String(ent?.name ?? ''),
        clientName: String((ent as { client?: unknown } | undefined)?.client ?? ''),
        deletedAt: rec.deleted!.at,
        deletedBy: rec.deleted!.by,
        reason: rec.deleted!.reason
      };
    });
  }
}
