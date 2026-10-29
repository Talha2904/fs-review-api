import { can, type PermissionMatrix } from '@fs-review/shared';

import type { ActivityEntry } from '../../domain/activity/ActivityEntry.js';
import { forbidden } from '../../domain/errors.js';
import type { Actor } from '../../domain/identity/User.js';
import { requirePermission } from '../identity/authorize.js';
import type { ActivityLog } from '../ports/ActivityLog.js';

/** Administrators read everything; other signed-in users read one fund's entries at a time. */
export class ListActivity {
  constructor(private readonly log: ActivityLog) {}

  async execute(actor: Actor | null, matrix: PermissionMatrix, engagementId: string | null, limit: number): Promise<ActivityEntry[]> {
    requirePermission(actor, 'activity.write', matrix);
    const all = can(actor, 'activity.read', matrix);
    if (!all && !engagementId) throw forbidden('Choose a fund to see its activity.');
    const entries = await this.log.list({ engagementId, limit: Math.min(20000, limit || 5000) });
    return entries.slice(0, 2000);
  }
}
