// The Consolidated Review (meeting point 2): every fund of every entity that shares a Client name and year end,
// reviewed together. It reads each fund's latest saved analysis (never the documents again), lets the shared
// engine pair balances and group recurring points, and, where the clients permit AI and it is turned on, asks
// Claude only to pair what is named by role and to group points worded differently. It runs as a background
// job like an analysis, records which analysis runs it read, and says when a fund has changed since.
import type { PermissionMatrix } from '@fs-review/shared';
import {
  aiInput,
  applyAiAnswer,
  consolidate,
  currencyOf,
  fundAi,
  groupKeyOf,
  type AnalysisResult,
  type ConsolidationAiAnswer,
  type GroupMember,
  type MemberPoint
} from '@fs-review/shared/analysis';

import { AppError, conflict, notFound, validationFailed } from '../../domain/errors.js';
import { actorOf, type Actor } from '../../domain/identity/User.js';
import type { Person } from '../../domain/review/Document.js';
import type { EngagementDocument } from '../../domain/review/Engagement.js';
import type { EntityDocument } from '../../domain/review/Entity.js';
import type { ActivityRecorder } from '../activity/ActivityRecorder.js';
import type { LoadAiSettings } from '../ai/AiSettingsUseCases.js';
import type { RunAiStep } from '../ai/RunAiStep.js';
import { requirePermission } from '../identity/authorize.js';
import type { AiGateway } from '../ports/AiGateway.js';
import type { AnalysisRunRepository } from '../ports/AnalysisRunRepository.js';
import type { Clock } from '../ports/Clock.js';
import {
  isActiveConsolidation,
  type ConsolidatedReviewRecord,
  type ConsolidatedReviewRepository
} from '../ports/ConsolidatedReviewRepository.js';
import type { EngagementRepository } from '../ports/EngagementRepository.js';
import type { EntityRepository } from '../ports/EntityRepository.js';
import type { EventBus } from '../ports/EventBus.js';
import type { IdGenerator } from '../ports/IdGenerator.js';
import type { JobQueue } from '../ports/JobQueue.js';
import type { Logger } from '../ports/Logger.js';
import type { PermissionRepository } from '../ports/PermissionRepository.js';
import type { PointRepository } from '../ports/PointRepository.js';
import type { UserRepository } from '../ports/UserRepository.js';

const who = (a: Actor): Person => ({ id: a.id, name: a.name, role: a.role });
/** The steps the screens show while a review runs. */
export const CONSOLIDATED_STEPS = [
  'Reading each fund’s latest analysis',
  'Matching balances between entities',
  'AI review of what needs judgement',
  'Saving the review'
];
const TOPIC = 'consolidated_reviews';
/** Thrown when a save finds the review no longer running: it was given up as stuck while this job ran. */
class GivenUp extends Error {}

export interface GroupFund {
  engagementId: string;
  fundName: string;
  entityName: string;
  entityType: string;
  currency: string;
  engagement: EngagementDocument;
  entity: EntityDocument | null;
}
export interface Group {
  groupKey: string;
  groupName: string;
  yearEnd: string;
  funds: GroupFund[];
}

/** Every group of two or more funds: entities with the same Client name (else name), funds with the same year end. */
export async function loadGroups(engagements: EngagementRepository, entities: EntityRepository): Promise<Group[]> {
  const [engs, ents] = await Promise.all([engagements.list(), entities.list()]);
  const entity = new Map(ents.map((e) => [e.doc.id, e.doc]));
  const groups = new Map<string, Group>();
  for (const { doc: eng } of engs) {
    const ent = eng.entityId ? (entity.get(eng.entityId) ?? null) : null;
    if (!ent) continue; // a fund with no entity has no client to group by
    const client = String((ent as { client?: unknown }).client || '').trim();
    const groupKey = groupKeyOf(client, ent.name);
    const yearEnd = String(eng.fund?.yearEnd || '');
    const key = `${groupKey}|${yearEnd}`;
    const g = groups.get(key) ?? { groupKey, groupName: client || String(ent.name || ''), yearEnd, funds: [] };
    g.funds.push({
      engagementId: eng.id,
      fundName: String(eng.fund?.name || ''),
      entityName: String(ent.name || ''),
      entityType: String((ent as { entityType?: unknown }).entityType || ''),
      currency: currencyOf(eng.fund?.currency),
      engagement: eng,
      entity: ent
    });
    groups.set(key, g);
  }
  return [...groups.values()]
    .filter((g) => g.funds.length >= 2)
    .sort((a, b) => a.groupName.localeCompare(b.groupName) || b.yearEnd.localeCompare(a.yearEnd));
}

/** What changed since a review: funds re-analysed, added to the group, or no longer in it. */
export function staleness(review: ConsolidatedReviewRecord | null, group: Group, latestRunOf: Map<string, string>) {
  if (!review) return null;
  const read = review.runIds || {};
  const name = (id: string) => group.funds.find((f) => f.engagementId === id)?.fundName || id;
  const changed = group.funds
    .filter((f) => f.engagementId in read && (read[f.engagementId] ?? null) !== (latestRunOf.get(f.engagementId) ?? null))
    .map((f) => f.fundName);
  const added = group.funds.filter((f) => !(f.engagementId in read)).map((f) => f.fundName);
  const removed = Object.keys(read)
    .filter((id) => !group.funds.some((f) => f.engagementId === id))
    .map(name);
  return changed.length || added.length || removed.length ? { changed, added, removed } : null;
}

const summaryOf = (r: ConsolidatedReviewRecord | null) =>
  r && {
    id: r.id,
    status: r.status,
    step: r.step,
    total: r.total,
    error: r.error,
    requestedBy: r.requestedBy,
    createdAt: r.createdAt,
    finishedAt: r.finishedAt
  };

export class ListConsolidatedGroups {
  constructor(
    private readonly engagements: EngagementRepository,
    private readonly entities: EntityRepository,
    private readonly runs: AnalysisRunRepository,
    private readonly reviews: ConsolidatedReviewRepository
  ) {}

  async execute(actor: Actor | null, matrix: PermissionMatrix) {
    requirePermission(actor, 'reviews.read', matrix);
    const [groups, latestRuns, latest] = await Promise.all([
      loadGroups(this.engagements, this.entities),
      this.runs.latestAll(),
      this.reviews.latestAll()
    ]);
    const runOf = new Map(latestRuns.map((r) => [r.engagementId, r.id]));
    return groups.map((g) => {
      const last = latest.find((r) => r.groupKey === g.groupKey && r.yearEnd === g.yearEnd) ?? null;
      return {
        groupKey: g.groupKey,
        groupName: g.groupName,
        yearEnd: g.yearEnd,
        funds: g.funds.map((f) => ({
          engagementId: f.engagementId,
          fundName: f.fundName,
          entityName: f.entityName,
          analysed: runOf.has(f.engagementId)
        })),
        latest: summaryOf(last),
        // whether the last finished review is out of date is worked out on the review screen itself
        analysedCount: g.funds.filter((f) => runOf.has(f.engagementId)).length
      };
    });
  }
}

export class GetConsolidatedReview {
  constructor(
    private readonly engagements: EngagementRepository,
    private readonly entities: EntityRepository,
    private readonly runs: AnalysisRunRepository,
    private readonly reviews: ConsolidatedReviewRepository
  ) {}

  async execute(actor: Actor | null, matrix: PermissionMatrix, groupKey: string, yearEnd: string) {
    requirePermission(actor, 'reviews.read', matrix);
    const group = (await loadGroups(this.engagements, this.entities)).find((g) => g.groupKey === groupKey && g.yearEnd === yearEnd);
    if (!group) throw notFound('That group of funds');
    const [latest, done, latestRuns] = await Promise.all([
      this.reviews.latest(groupKey, yearEnd),
      this.reviews.latestDone(groupKey, yearEnd),
      this.runs.latestAll()
    ]);
    const runOf = new Map(latestRuns.map((r) => [r.engagementId, r.id]));
    return {
      group: {
        groupKey,
        groupName: group.groupName,
        yearEnd,
        funds: group.funds.map((f) => ({
          engagementId: f.engagementId,
          fundName: f.fundName,
          entityName: f.entityName,
          currency: f.currency,
          analysed: runOf.has(f.engagementId)
        }))
      },
      latest: summaryOf(latest),
      review: done ? { id: done.id, finishedAt: done.finishedAt, requestedBy: done.requestedBy, result: done.result } : null,
      stale: staleness(done, group, runOf)
    };
  }
}

export class StartConsolidatedReview {
  constructor(
    private readonly engagements: EngagementRepository,
    private readonly entities: EntityRepository,
    private readonly runs: AnalysisRunRepository,
    private readonly reviews: ConsolidatedReviewRepository,
    private readonly queue: JobQueue,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly events: EventBus
  ) {}

  async execute(actor: Actor | null, matrix: PermissionMatrix, groupKey: string, yearEnd: string): Promise<ConsolidatedReviewRecord> {
    const by = requirePermission(actor, 'analysis.run', matrix);
    const group = (await loadGroups(this.engagements, this.entities)).find((g) => g.groupKey === groupKey && g.yearEnd === yearEnd);
    if (!group) throw notFound('That group of funds');
    const analysed = new Set((await this.runs.latestAll()).map((r) => r.engagementId));
    if (group.funds.filter((f) => analysed.has(f.engagementId)).length < 2)
      throw validationFailed('At least two funds in this group need a completed analysis before they can be reviewed together.');
    if (isActiveConsolidation(await this.reviews.latest(groupKey, yearEnd)))
      throw conflict('A Consolidated Review of this group is already running.');
    const now = this.clock.nowIso();
    const record: ConsolidatedReviewRecord = {
      id: this.ids.next(),
      groupKey,
      groupName: group.groupName,
      yearEnd,
      status: 'queued',
      step: 0,
      total: CONSOLIDATED_STEPS.length,
      error: null,
      runIds: {},
      result: null,
      requestedBy: who(by),
      createdAt: now,
      startedAt: null,
      finishedAt: null
    };
    if (!(await this.reviews.createIfIdle(record))) throw conflict('A Consolidated Review of this group is already running.');
    await this.events.publish({ topic: TOPIC, at: now, data: { id: record.id, groupKey, yearEnd, status: 'queued' } });
    this.queue.enqueue(record.id);
    return record;
  }
}

export interface RunConsolidatedReviewDeps {
  reviews: ConsolidatedReviewRepository;
  engagements: EngagementRepository;
  entities: EntityRepository;
  runs: AnalysisRunRepository;
  points: PointRepository;
  users: UserRepository;
  permissions: PermissionRepository;
  loadAi: LoadAiSettings;
  gateway: AiGateway;
  runAiStep: RunAiStep;
  activity: ActivityRecorder;
  clock: Clock;
  events: EventBus;
  logger: Logger;
}

/** Runs one queued Consolidated Review as the person who started it. Called by its job queue. */
export class RunConsolidatedReview {
  constructor(private readonly d: RunConsolidatedReviewDeps) {}

  async execute(id: string): Promise<void> {
    const queued = await this.d.reviews.findById(id);
    if (!queued || queued.status !== 'queued') return;
    let rec: ConsolidatedReviewRecord = { ...queued, status: 'running', startedAt: this.d.clock.nowIso() };
    let actor: Actor | null = null;
    try {
      await this.save(rec, false);
      const user = await this.d.users.findById(rec.requestedBy.id);
      if (!user?.active) throw validationFailed('The person who started this review can no longer sign in.');
      actor = actorOf(user);
      const matrix = await this.d.permissions.get();
      requirePermission(actor, 'analysis.run', matrix);
      const group = (await loadGroups(this.d.engagements, this.d.entities)).find(
        (g) => g.groupKey === rec.groupKey && g.yearEnd === rec.yearEnd
      );
      if (!group) throw validationFailed('This group of funds no longer exists.');

      // 1. each fund's latest analysis and its current review points
      const members: GroupMember[] = [];
      const points: MemberPoint[] = [];
      const runIds: Record<string, string | null> = {};
      for (const f of group.funds) {
        const [run, pts] = await Promise.all([this.d.runs.latest(f.engagementId), this.d.points.listByEngagement(f.engagementId)]);
        runIds[f.engagementId] = run?.id ?? null;
        members.push({
          engagementId: f.engagementId,
          fundName: f.fundName,
          entityName: f.entityName,
          entityType: f.entityType || undefined,
          currency: f.currency,
          result: run ? (run.result as unknown as AnalysisResult) : null,
          aiAllowed: fundAi(f.engagement, f.entity) === 'permitted'
        });
        for (const p of pts)
          points.push({
            engagementId: f.engagementId,
            ref: p.ref,
            title: String(p.content.title ?? ''),
            area: typeof p.content.area === 'string' ? p.content.area : undefined,
            rule: typeof p.content.rule === 'string' ? p.content.rule : undefined,
            kind: typeof p.content.kind === 'string' ? p.content.kind : undefined,
            status: p.status
          });
      }
      rec = await this.tick(rec, 1);

      // 2. what the app can match on its own
      const base = consolidate(members, points);
      rec = await this.tick(rec, 2);

      // 3. AI, only for what needs judgement, only with funds whose client permits it, only when turned on
      const ai = await this.d.loadAi.execute();
      const input = aiInput(members, base.unmatched, base.restPoints);
      // only what was sent can come back: ids of funds whose client does not permit AI are never accepted
      const sentLines = new Set(input.lines.map((l) => l.id));
      const sentPoints = new Set(input.points.map((p) => `${p.fund}|${p.ref}`));
      const currencies = new Set(group.funds.map((f) => f.currency));
      const fundName = (eid: string) => group.funds.find((f) => f.engagementId === eid)?.fundName || eid;
      let links = base.links,
        groups = base.groups,
        summary = '',
        aiNote = '';
      const hasWork = input.members.length >= 2 && (input.lines.length >= 2 || input.points.length >= 2);
      if (!this.d.gateway.keyStatus().configured)
        aiNote = 'No Claude API key is set on the server, so only the app’s own matching was used.';
      else if (!ai.enabled) aiNote = 'AI is turned off under AI Settings, so only the app’s own matching was used.';
      else if (ai.steps.consolidated === false)
        aiNote = 'The Consolidated review AI step is turned off under AI Settings, so only the app’s own matching was used.';
      else if (input.members.length < 2)
        aiNote =
          'Fewer than two of these funds have AI permitted (by their client or the fund itself), so only the app’s own matching was used.';
      else if (!hasWork) aiNote = 'AI was not needed: among the funds that permit it there was nothing left to pair or group.';
      else {
        try {
          const answer = (await this.d.runAiStep.execute(
            actor,
            matrix,
            { step: 'consolidated', input },
            {
              aiAllowed: true, // the payload holds only funds whose client permits AI
              // the prompt's default currency; with several, each line carries its own
              currency: currencies.size === 1 ? group.funds[0]!.currency : 'GBP',
              entityType: 'Group of related entities',
              framework: sameFramework(group),
              shareWith: input.members.map((m) => ({ engagementId: m.id, fundName: m.fund }))
            }
          )) as ConsolidationAiAnswer;
          const fromAi = applyAiAnswer(
            answer,
            base.unmatched.filter((c) => sentLines.has(c.id)),
            base.restPoints.filter((p) => sentPoints.has(`${p.engagementId}|${p.ref}`)),
            fundName
          );
          links = [...base.links, ...fromAi.links];
          groups = [...base.groups, ...fromAi.groups];
          summary = fromAi.summary;
          aiNote =
            fromAi.links.length || fromAi.groups.length
              ? `AI (${ai.model}) matched what the app could not; amounts were compared by the app.`
              : `AI (${ai.model}) looked at what the app could not match and found nothing further to pair or group.`;
        } catch (e) {
          // commentary only: the app's own matching stands, and the review says AI did not complete
          aiNote = `The AI step did not complete (${e instanceof AppError ? e.message : 'unexpected error'}), so only the app’s own matching is shown.`;
          if (!(e instanceof AppError)) this.d.logger.error({ err: e, id }, 'Consolidated review AI step failed');
        }
      }
      rec = await this.tick(rec, 3);

      // 4. save: lines that were matched by AI are no longer unmatched
      const linked = new Set(links.flatMap((l) => [l.a.id, l.b.id]));
      const result = {
        members: base.members,
        links,
        unmatched: base.unmatched.filter((c) => !linked.has(c.id)),
        groups,
        summary,
        aiNote
      };
      rec = { ...rec, status: 'done', step: rec.total, runIds, result, finishedAt: this.d.clock.nowIso() };
      await this.save(rec); // only while still running: a review given up as stuck meanwhile stays failed
      const differing = links.filter((l) => l.status === 'differs').length;
      // the review is saved: a failure to log it must not turn it into a failed review
      await this.d.activity
        .record({
          actor,
          category: 'Analysis',
          summary: `Ran the Consolidated Review of ${rec.groupName} (${rec.yearEnd})`,
          details: `${group.funds.length} funds · ${links.length} inter-entity link${links.length === 1 ? '' : 's'}, ${differing} differ · ${groups.length} common matter${groups.length === 1 ? '' : 's'}`,
          engagementId: null,
          fundName: null
        })
        .catch((err: unknown) => this.d.logger.error({ err, id }, 'Could not log a finished consolidated review'));
    } catch (e) {
      if (e instanceof GivenUp) return; // stopped as stuck meanwhile: that verdict stands
      const message =
        e instanceof AppError
          ? e.message
          : 'The Consolidated Review could not be completed. Try again, and tell an Administrator if it keeps failing.';
      if (!(e instanceof AppError)) this.d.logger.error({ err: e, id }, 'Consolidated review failed');
      rec = { ...rec, status: 'failed', error: message, finishedAt: this.d.clock.nowIso() };
      await this.save(rec)
        .catch((err: unknown) => (err instanceof GivenUp ? undefined : Promise.reject(err)))
        .catch((err: unknown) => this.d.logger.error({ err, id }, 'Could not record a failed consolidated review'));
    }
  }

  private async tick(rec: ConsolidatedReviewRecord, step: number) {
    const next = { ...rec, step };
    await this.save(next);
    return next;
  }

  /** Saves and announces it; after the start, only while the review is still running (else it was given up). */
  private async save(rec: ConsolidatedReviewRecord, whileRunning = true) {
    if (!whileRunning) await this.d.reviews.update(rec);
    else if (!(await this.d.reviews.updateWhileRunning(rec))) throw new GivenUp();
    await this.d.events.publish({
      topic: TOPIC,
      at: this.d.clock.nowIso(),
      data: { id: rec.id, groupKey: rec.groupKey, yearEnd: rec.yearEnd, status: rec.status, step: rec.step }
    });
  }
}

/** The group's accounting framework when every entity has the same one; otherwise the prompt reads it from the documents. */
function sameFramework(group: Group): string | null {
  const fws = new Set(group.funds.map((f) => String((f.entity as { framework?: unknown } | null)?.framework || '')));
  return fws.size === 1 ? [...fws][0] || null : null;
}

/** After a restart, and every few minutes: the same rules as analysis jobs (ADR 0011). */
export class RecoverConsolidatedReviews {
  constructor(
    private readonly reviews: ConsolidatedReviewRepository,
    private readonly queue: JobQueue,
    private readonly clock: Clock,
    private readonly events: EventBus
  ) {}

  /** Marks a review failed and tells open screens, so they stop showing it as running. */
  private async fail(r: ConsolidatedReviewRecord, error: string) {
    const at = this.clock.nowIso();
    await this.reviews.update({ ...r, status: 'failed', error, finishedAt: at });
    await this.events.publish({ topic: TOPIC, at, data: { id: r.id, groupKey: r.groupKey, yearEnd: r.yearEnd, status: 'failed' } });
  }

  async reapStale(maxMinutes = 60): Promise<number> {
    const cutoff = this.clock.now().getTime() - maxMinutes * 60_000;
    let n = 0;
    for (const r of await this.reviews.listByStatus(['running']))
      if (r.startedAt && Date.parse(r.startedAt) < cutoff) {
        await this.fail(r, 'The review took too long and was stopped. Run it again.');
        n++;
      }
    return n;
  }

  async execute(): Promise<{ failed: number; requeued: number }> {
    let failed = 0,
      requeued = 0;
    for (const r of await this.reviews.listByStatus(['running', 'queued'])) {
      if (r.status === 'running') {
        await this.fail(r, 'The server restarted while this review was running. Run it again.');
        failed++;
      } else {
        this.queue.enqueue(r.id);
        requeued++;
      }
    }
    return { failed, requeued };
  }
}
