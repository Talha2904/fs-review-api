// The portfolio and the bell, worked out on the api (plan section 7.5): the stage every fund has reached and
// who it waits for, and the actions and updates for the signed-in person. The rules are in
// @fs-review/shared (reviewStatus.ts); the screens only show the results.
import {
  notificationsFor,
  stageOf,
  type Notice,
  type PermissionMatrix,
  type ScreenTab,
  type StageName,
  type TeamRole
} from '@fs-review/shared';

import type { Actor } from '../../domain/identity/User.js';
import { requirePermission } from '../identity/authorize.js';
import type { BellReadModel } from '../ports/BellReadModel.js';
import type { Clock } from '../ports/Clock.js';
import type { EngagementRepository } from '../ports/EngagementRepository.js';
import type { EntityRepository } from '../ports/EntityRepository.js';
import type { PortfolioReadModel } from '../ports/PortfolioReadModel.js';
import type { UserRepository } from '../ports/UserRepository.js';

const TEAM: readonly TeamRole[] = ['preparer', 'reviewer', 'manager', 'partner'];

export interface PortfolioRow {
  engagementId: string;
  client: string;
  fund: string;
  yearEnd: string;
  stage: StageName;
  /** the stage's place in the list, for sorting */
  order: number;
  /** the screen to open for this stage */
  tab: ScreenTab;
  owner: TeamRole | null;
  ownerName: string;
  team: Record<TeamRole, string>;
  /** user ids of the fund's named team, for "My funds" */
  teamIds: string[];
  open: number;
  responded: number;
  overdue: number;
  lastActivityAt: string | null;
}

export class GetPortfolio {
  constructor(
    private readonly engagements: EngagementRepository,
    private readonly entities: EntityRepository,
    private readonly users: UserRepository,
    private readonly readModel: PortfolioReadModel,
    private readonly clock: Clock
  ) {}

  async execute(actor: Actor | null, matrix: PermissionMatrix): Promise<{ rows: PortfolioRow[] }> {
    requirePermission(actor, 'reviews.read', matrix);
    const today = this.clock.nowIso().slice(0, 10);
    const [funds, entities, users, activity] = await Promise.all([
      this.engagements.list(),
      this.entities.list(),
      this.users.list(),
      this.readModel.activity(today)
    ]);
    const nameOf = new Map(users.map((u) => [u.id, u.name]));
    const clientOf = new Map(entities.map((e) => [e.doc.id, e.doc.name]));
    const activityOf = new Map(activity.map((a) => [a.engagementId, a]));
    const rows = funds.map(({ doc: e, updatedAt }): PortfolioRow => {
      const a = activityOf.get(e.id);
      const s = stageOf({
        hasDocuments: !!a?.hasDocuments,
        workflowState: a?.workflowState ?? 'preparing',
        signoffState: a?.signoffState ?? 'none',
        analysed: !!a?.analysed,
        openPoints: a?.openPoints ?? 0,
        respondedPoints: a?.respondedPoints ?? 0
      });
      const fund = e.fund as Record<string, unknown>;
      // the person's current name from their account, else the name saved on the fund
      const team = Object.fromEntries(
        TEAM.map((k) => {
          const id = fund?.[`${k}Id`];
          const saved = fund?.[k];
          return [k, (typeof id === 'string' && nameOf.get(id)) || (typeof saved === 'string' ? saved : '')];
        })
      ) as Record<TeamRole, string>;
      return {
        engagementId: e.id,
        client: (e.entityId && clientOf.get(e.entityId)) || 'No client',
        fund: String(e.fund?.name || 'Untitled'),
        yearEnd: String(e.fund?.yearEnd || ''),
        stage: s.stage,
        order: s.order,
        tab: s.tab,
        owner: s.owner,
        ownerName: s.owner ? team[s.owner] || `the ${s.owner}` : '—',
        team,
        teamIds: TEAM.map((k) => fund?.[`${k}Id`]).filter((x): x is string => typeof x === 'string' && !!x),
        open: a?.openPoints ?? 0,
        responded: a?.respondedPoints ?? 0,
        overdue: a?.overduePoints ?? 0,
        lastActivityAt: a?.lastActivityAt ?? (String(e.savedAt || '') || updatedAt)
      };
    });
    // funds with overdue points first, then by stage, then by name
    rows.sort((x, y) => y.overdue - x.overdue || x.order - y.order || x.fund.localeCompare(y.fund));
    return { rows };
  }
}

/** The bell lists this many actions, newest first; actionCount says how many there are in all. */
export const BELL_ACTIONS = 50;
/** Updates come from point threads of the last 90 days (the bell shows the newest 60). */
export const BELL_UPDATE_DAYS = 90;

export interface Notifications {
  actions: Notice[];
  actionCount: number;
  updates: Notice[];
}

export class GetNotifications {
  constructor(
    private readonly engagements: EngagementRepository,
    private readonly entities: EntityRepository,
    private readonly bell: BellReadModel,
    private readonly clock: Clock
  ) {}

  async execute(actor: Actor | null, matrix: PermissionMatrix): Promise<Notifications> {
    const by = requirePermission(actor, 'activity.write', matrix);
    // Finance works only in billing: no review notifications
    if (by.role === 'Finance') return { actions: [], actionCount: 0, updates: [] };
    const now = this.clock.nowIso();
    const since = new Date(Date.parse(now) - BELL_UPDATE_DAYS * 86_400_000).toISOString();
    const [funds, entities, reviews] = await Promise.all([this.engagements.list(), this.entities.list(), this.bell.reviews(by.id, since)]);
    const { actions, updates } = notificationsFor(
      by,
      matrix,
      funds.map((r) => r.doc),
      entities.map((r) => r.doc),
      reviews,
      now.slice(0, 10)
    );
    return { actions: actions.slice(0, BELL_ACTIONS), actionCount: actions.length, updates };
  }
}
