// Review points shared across related funds (meeting point 4). A shared point is not a new kind of record: each
// fund keeps its own ordinary point (its status, assignee, due date and sign-off all work as before, and it is
// cleared in that fund), and the copies carry one sharedGroupId so their threads are read together. Funds can share
// a point only within one Consolidated Review group (entities with the same Client name, funds with the same year
// end), at most one copy per fund, and never while a fund is signed off.
import { isLockedSignoff, type PermissionMatrix } from '@fs-review/shared';

import { AppError, notFound, validationFailed } from '../../domain/errors.js';
import type { Actor } from '../../domain/identity/User.js';
import type { Person } from '../../domain/review/Document.js';
import { nextRef, typeFor, type PointContent, type PointMessage, type ReviewPoint } from '../../domain/review/Point.js';
import { requirePermission } from '../identity/authorize.js';
import type { Clock } from '../ports/Clock.js';
import type { EngagementRepository } from '../ports/EngagementRepository.js';
import type { EntityRepository } from '../ports/EntityRepository.js';
import type { EventBus } from '../ports/EventBus.js';
import type { IdGenerator } from '../ports/IdGenerator.js';
import type { PointMessageRepository, PointRepository } from '../ports/PointRepository.js';
import type { SignoffRepository } from '../ports/SignoffRepository.js';

import { loadGroups, type Group } from './ConsolidatedReviewUseCases.js';
import type { ReviewAccess } from './access.js';

const who = (a: Actor): Person => ({ id: a.id, name: a.name, role: a.role });
/** What a copy in another fund carries over: the matter itself, not the first fund's own locations or AI notes. */
const SHARED_FIELDS = ['title', 'pri', 'area', 'basis', 'follow', 'rule'] as const;

class SharedBase {
  constructor(
    protected readonly access: ReviewAccess,
    protected readonly points: PointRepository,
    protected readonly messages: PointMessageRepository,
    protected readonly engagements: EngagementRepository,
    protected readonly entities: EntityRepository,
    protected readonly ids: IdGenerator,
    protected readonly clock: Clock,
    protected readonly events: EventBus,
    protected readonly signoffs: SignoffRepository
  ) {}

  /** The Consolidated Review group a fund belongs to. */
  protected async groupOf(engagementId: string): Promise<Group> {
    const g = (await loadGroups(this.engagements, this.entities)).find((x) => x.funds.some((f) => f.engagementId === engagementId));
    if (!g)
      throw validationFailed(
        'This fund is not in a group: points can be shared only between funds whose entities have the same Client name and year end.'
      );
    return g;
  }

  /** The right to raise points in every fund, checked first so nothing changes when one fund is refused. */
  protected async writers(actor: Actor | null, matrix: PermissionMatrix, group: Group, engagementIds: string[]): Promise<Actor> {
    const locked: string[] = [];
    let by: Actor | null = null;
    for (const id of engagementIds) {
      try {
        by = await this.access.writer(actor, matrix, id, ['points.raise']);
      } catch (e) {
        if (e instanceof AppError && e.code === 'LOCKED') locked.push(fundName(group, id));
        else throw e;
      }
    }
    if (locked.length)
      throw validationFailed(`${locked.join(', ')} ${locked.length === 1 ? 'is' : 'are'} signed off, so no point can be shared there.`);
    return by!;
  }

  /** A line in a point's thread, saved together with the change it describes. */
  protected msg(p: ReviewPoint, kind: 'note' | 'raise', by: Person, text: string): PointMessage {
    return {
      id: this.ids.next(),
      pointId: p.id,
      engagementId: p.engagementId,
      kind,
      author: by,
      at: this.clock.nowIso(),
      text,
      attachments: []
    };
  }

  protected async isLocked(engagementId: string): Promise<boolean> {
    const s = await this.signoffs.get(engagementId);
    return !!s && isLockedSignoff(s.state);
  }

  protected async changed(engagementIds: Iterable<string>): Promise<void> {
    for (const engagementId of new Set(engagementIds))
      await this.events.publish({ topic: 'review_points', engagementId, at: this.clock.nowIso() });
  }
}

const fundName = (g: Group, id: string) => g.funds.find((f) => f.engagementId === id)?.fundName || 'A fund';
const label = (g: Group, p: ReviewPoint) => `${fundName(g, p.engagementId)} ${p.ref}`;

/**
 * Links points that are already the same matter in several funds (from the Consolidated Review's shared points)
 * into one shared point. A point already shared can be extended with more funds; two different shared points are
 * never merged.
 */
export class LinkSharedPoints extends SharedBase {
  async execute(
    actor: Actor | null,
    matrix: PermissionMatrix,
    pointIds: string[]
  ): Promise<{ sharedGroupId: string; points: ReviewPoint[] }> {
    const ids = [...new Set(pointIds)];
    if (ids.length < 2) throw validationFailed('Choose points in at least two funds.');
    const pts: ReviewPoint[] = [];
    for (const id of ids) {
      const p = await this.points.findById(id);
      if (!p) throw notFound('That review point');
      pts.push(p);
    }
    const group = await this.groupOf(pts[0]!.engagementId);
    if (pts.some((p) => !group.funds.some((f) => f.engagementId === p.engagementId)))
      throw validationFailed('These points are not all in one group of related funds.');
    const existing = [...new Set(pts.map((p) => p.sharedGroupId).filter((g): g is string => !!g))];
    if (existing.length > 1) throw validationFailed('Some of these points are already shared separately. Stop sharing one of them first.');
    const sharedGroupId = existing[0] ?? this.ids.next();
    const members = existing.length ? await this.points.listBySharedGroups(existing) : [];
    const all = [...members, ...pts.filter((p) => !members.some((m) => m.id === p.id))];
    if (new Set(all.map((p) => p.engagementId)).size !== all.length)
      throw validationFailed('A shared point can have only one copy in each fund.');
    const adding = pts.filter((p) => p.sharedGroupId !== sharedGroupId);
    if (!adding.length) return { sharedGroupId, points: all };
    const by = who(
      await this.writers(
        actor,
        matrix,
        group,
        adding.map((p) => p.engagementId)
      )
    );
    const now = this.clock.nowIso();
    const out = adding.map((p) => ({ ...p, sharedGroupId, updatedAt: now }));
    const linked = all.map((p) => out.find((x) => x.id === p.id) ?? p);
    // all or nothing: a point changed meanwhile (a comment, a new analysis) leaves every point as it was
    await this.points.saveShared({
      create: [],
      update: out.map((point, i) => ({ point, expectedUpdatedAt: adding[i]!.updatedAt })),
      messages: out.map((p) =>
        this.msg(
          p,
          'note',
          by,
          `Shared with ${linked
            .filter((x) => x.id !== p.id)
            .map((x) => label(group, x))
            .join(', ')} by ${by.name}. Each fund clears its own copy.`
        )
      )
    });
    await this.changed(linked.map((p) => p.engagementId));
    return { sharedGroupId, points: linked };
  }
}

/** Raises a copy of one fund's point in other funds of its group (references SP-1, SP-2 …, which no analysis uses). */
export class SharePoint extends SharedBase {
  async execute(
    actor: Actor | null,
    matrix: PermissionMatrix,
    pointId: string,
    engagementIds: string[]
  ): Promise<{ sharedGroupId: string; points: ReviewPoint[] }> {
    const p = await this.points.findById(pointId);
    if (!p) throw notFound('That review point');
    const targets = [...new Set(engagementIds)].filter((id) => id !== p.engagementId);
    if (!targets.length) throw validationFailed('Choose at least one other fund.');
    const group = await this.groupOf(p.engagementId);
    if (targets.some((id) => !group.funds.some((f) => f.engagementId === id)))
      throw validationFailed('Points can be shared only with funds in the same group.');
    const members = p.sharedGroupId ? await this.points.listBySharedGroups([p.sharedGroupId]) : [p];
    const already = targets.filter((id) => members.some((m) => m.engagementId === id));
    if (already.length) throw validationFailed(`${already.map((id) => fundName(group, id)).join(', ')} already has a copy of this point.`);
    const by = who(await this.writers(actor, matrix, group, [p.engagementId, ...targets]));
    const sharedGroupId = p.sharedGroupId ?? this.ids.next();
    const now = this.clock.nowIso();
    const content: PointContent = { title: String(p.content.title || '') };
    for (const k of SHARED_FIELDS) if (p.content[k] !== undefined) content[k] = p.content[k];
    content.sharedFrom = { engagementId: p.engagementId, ref: p.ref };
    const created: ReviewPoint[] = [];
    const notes: PointMessage[] = [];
    for (const engagementId of targets) {
      const ref = nextRef(
        'SP-',
        (await this.points.listByEngagement(engagementId)).map((x) => x.ref)
      );
      const rec: ReviewPoint = {
        id: this.ids.next(),
        engagementId,
        ref,
        source: 'manual',
        content: { ...content, ref },
        status: 'open',
        type: p.type,
        dueDate: null,
        assignedTo: null, // each fund has its own team: assigned there
        raisedBy: by,
        raisedAt: now,
        clearedBy: null,
        clearedAt: null,
        updatedAt: now,
        sharedGroupId
      };
      created.push(rec);
      notes.push(this.msg(rec, 'raise', by, `Shared from ${label(group, p)} by ${by.name}. Each fund clears its own copy.`));
    }
    // the source is linked in the same transaction as its copies (and checked unchanged since it was read), so a
    // clash saves nothing: no copy is left without its source, and trying again cannot make a second copy
    const source = { ...p, sharedGroupId, updatedAt: now };
    notes.push(this.msg(source, 'note', by, `Shared with ${created.map((x) => label(group, x)).join(', ')} by ${by.name}.`));
    await this.points.saveShared({ create: created, update: [{ point: source, expectedUpdatedAt: p.updatedAt }], messages: notes });
    const all = [...members.filter((m) => m.id !== p.id), source, ...created];
    await this.changed(all.map((x) => x.engagementId));
    return { sharedGroupId, points: all };
  }
}

const PRIORITIES = ['High', 'Medium', 'Low'];

/**
 * A common review point: one new matter raised in several related funds at once (from the Portfolio or the
 * Consolidated Review). Each fund gets its own copy (SP-n) to respond to and clear; the copies share one thread.
 */
export class RaiseCommonPoint extends SharedBase {
  async execute(
    actor: Actor | null,
    matrix: PermissionMatrix,
    engagementIds: string[],
    input: { title?: unknown; basis?: unknown; pri?: unknown; area?: unknown }
  ): Promise<{ sharedGroupId: string; points: ReviewPoint[] }> {
    requirePermission(actor, 'points.raise', matrix); // a role that cannot raise points is told so first
    const funds = [...new Set(engagementIds)];
    if (funds.length < 2) throw validationFailed('Choose at least two funds for a common review point.');
    const title = String(input.title ?? '').trim();
    if (!title) throw validationFailed('Give the point a title.');
    const group = await this.groupOf(funds[0]!);
    if (funds.some((id) => !group.funds.some((f) => f.engagementId === id)))
      throw validationFailed('A common review point can be raised only in funds of one group.');
    const by = who(await this.writers(actor, matrix, group, funds));
    const content: PointContent = { title };
    const basis = String(input.basis ?? '').trim();
    if (basis) content.basis = basis;
    const area = String(input.area ?? '').trim();
    if (area) content.area = area;
    content.pri = PRIORITIES.includes(String(input.pri)) ? String(input.pri) : 'Medium';
    const sharedGroupId = this.ids.next();
    const now = this.clock.nowIso();
    const created: ReviewPoint[] = [];
    for (const engagementId of funds) {
      const ref = nextRef(
        'SP-',
        (await this.points.listByEngagement(engagementId)).map((x) => x.ref)
      );
      created.push({
        id: this.ids.next(),
        engagementId,
        ref,
        source: 'manual',
        content: { ...content, ref },
        status: 'open',
        type: typeFor(content),
        dueDate: null,
        assignedTo: null,
        raisedBy: by,
        raisedAt: now,
        clearedBy: null,
        clearedAt: null,
        updatedAt: now,
        sharedGroupId
      });
    }
    const messages = created.map((p) =>
      this.msg(
        p,
        'raise',
        by,
        `Raised by ${by.name} as a common review point, also in ${created
          .filter((x) => x.id !== p.id)
          .map((x) => label(group, x))
          .join(', ')}. Each fund clears its own copy.`
      )
    );
    await this.points.saveShared({ create: created, update: [], messages });
    await this.changed(funds);
    return { sharedGroupId, points: created };
  }
}

/** Takes one fund's copy out of a shared point; the copy stays as an ordinary point of that fund. */
export class UnsharePoint extends SharedBase {
  async execute(actor: Actor | null, matrix: PermissionMatrix, pointId: string): Promise<ReviewPoint> {
    const p = await this.points.findById(pointId);
    if (!p) throw notFound('That review point');
    if (!p.sharedGroupId) return p;
    const by = who(await this.access.writer(actor, matrix, p.engagementId, ['points.raise']));
    const members = await this.points.listBySharedGroups([p.sharedGroupId]);
    const now = this.clock.nowIso();
    const next = { ...p, sharedGroupId: null, updatedAt: now };
    const update = [{ point: next, expectedUpdatedAt: p.updatedAt }];
    const messages = [this.msg(next, 'note', by, `No longer shared with the other funds (${by.name}). Their copies are unchanged.`)];
    // a copy left on its own is an ordinary point again (unless its fund is signed off: then it stays as it is)
    const rest = members.filter((m) => m.id !== p.id);
    if (rest.length === 1 && !(await this.isLocked(rest[0]!.engagementId))) {
      const last = { ...rest[0]!, sharedGroupId: null, updatedAt: now };
      update.push({ point: last, expectedUpdatedAt: rest[0]!.updatedAt });
      messages.push(this.msg(last, 'note', by, 'No longer shared: the other fund stopped sharing this point.'));
    }
    await this.points.saveShared({ create: [], update, messages });
    await this.changed(members.map((m) => m.engagementId));
    return next;
  }
}

/** The other funds' copies of this fund's shared points, and their threads: read with the fund's own review. */
export async function sharedFor(
  points: PointRepository,
  messages: PointMessageRepository,
  engagementId: string,
  own: ReviewPoint[]
): Promise<{ points: ReviewPoint[]; messages: Awaited<ReturnType<PointMessageRepository['listByPoints']>> }> {
  const groups = [...new Set(own.map((p) => p.sharedGroupId).filter((g): g is string => !!g))];
  if (!groups.length) return { points: [], messages: [] };
  const others = (await points.listBySharedGroups(groups)).filter((p) => p.engagementId !== engagementId);
  return { points: others, messages: await messages.listByPoints(others.map((p) => p.id)) };
}
