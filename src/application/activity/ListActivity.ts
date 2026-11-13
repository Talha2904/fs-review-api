import { can, type PermissionMatrix } from '@fs-review/shared';

import type { ActivityEntry } from '../../domain/activity/ActivityEntry.js';
import { forbidden, notFound } from '../../domain/errors.js';
import type { Actor } from '../../domain/identity/User.js';
import { requirePermission } from '../identity/authorize.js';
import type { ActivityLog } from '../ports/ActivityLog.js';
import type { EngagementRepository } from '../ports/EngagementRepository.js';

import type { ActivityRecorder, RecordInput } from './ActivityRecorder.js';

/**
 * What someone without the whole log (everyone except Administrators) sees of an entry: who did what, when,
 * and the plain details. The client's IP address and an AI call's model and token counts are technical
 * records for Administrators, so they are left out here, before they leave the server (screen and export).
 */
export function staffView(e: ActivityEntry): ActivityEntry {
  const { usage: _usage, ...rest } = e;
  return { ...rest, ip: '', details: e.usage || e.category === 'AI' ? '' : e.details };
}

/** An entry as listed: `fundDeleted` when its fund is deleted, so the screens show it without a link into the fund. */
export type ListedActivityEntry = ActivityEntry & { fundDeleted?: true };

/**
 * Administrators read everything; other signed-in users read one fund's entries at a time. A deleted fund's entries
 * stay in the whole log (the audit trail is never changed) but its own log answers 404 like the rest of the fund.
 */
export class ListActivity {
  constructor(
    private readonly log: ActivityLog,
    private readonly engagements: EngagementRepository
  ) {}

  async execute(actor: Actor | null, matrix: PermissionMatrix, engagementId: string | null, limit: number): Promise<ListedActivityEntry[]> {
    requirePermission(actor, 'activity.write', matrix);
    const all = can(actor, 'activity.read', matrix);
    if (!all && !engagementId) throw forbidden('Choose a fund to see its activity.');
    if (engagementId && (await this.engagements.findIncludingDeleted(engagementId))?.deleted) throw notFound('That engagement');
    const [entries, deleted] = await Promise.all([
      this.log.list({ engagementId, limit: Math.min(20000, limit || 5000) }),
      engagementId ? Promise.resolve([]) : this.engagements.listDeleted()
    ]);
    const gone = new Set(deleted.map((r) => r.doc.id));
    const shown = entries
      .slice(0, 2000)
      .map((e): ListedActivityEntry => (e.engagementId && gone.has(e.engagementId) ? { ...e, fundDeleted: true } : e));
    return all ? shown : shown.map(staffView);
  }
}

/** What the web app records itself. Never against a deleted fund (a tab left open on it): that fund answers 404. */
export class RecordAppActivity {
  constructor(
    private readonly activity: ActivityRecorder,
    private readonly engagements: EngagementRepository
  ) {}

  async execute(input: RecordInput) {
    if (input.engagementId && (await this.engagements.findIncludingDeleted(input.engagementId))?.deleted) throw notFound('That engagement');
    return this.activity.record(input);
  }
}
