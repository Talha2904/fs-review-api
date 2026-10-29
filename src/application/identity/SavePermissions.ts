import { describeMatrixChange, EDITABLE_PERMS, normalizeMatrix, STAFF_ROLES, type PermissionMatrix } from '@fs-review/shared';

import type { Actor } from '../../domain/identity/User.js';
import type { ActivityRecorder } from '../activity/ActivityRecorder.js';
import type { Clock } from '../ports/Clock.js';
import type { PermissionRepository } from '../ports/PermissionRepository.js';

import { requirePermission } from './authorize.js';

/** Anyone may read the matrix (the sign-in page shows it); only Administrators change it. */
export class GetPermissions {
  constructor(private readonly permissions: PermissionRepository) {}
  execute(): Promise<PermissionMatrix> {
    return this.permissions.get();
  }
}

export class SavePermissions {
  constructor(
    private readonly permissions: PermissionRepository,
    private readonly clock: Clock,
    private readonly activity: ActivityRecorder
  ) {}

  async execute(actor: Actor | null, current: PermissionMatrix, proposed: unknown, ip?: string): Promise<PermissionMatrix> {
    const by = requirePermission(actor, 'users.manage', current);
    const after = normalizeMatrix(proposed);
    await this.permissions.save(after, by.id, this.clock.nowIso());
    const changes = describeMatrixChange(current, after, EDITABLE_PERMS, STAFF_ROLES);
    if (changes.length)
      await this.activity.record({
        actor: by,
        category: 'Users',
        summary: 'Updated the permission matrix',
        details: changes.join(' · '),
        ip: ip ?? ''
      });
    return after;
  }
}
