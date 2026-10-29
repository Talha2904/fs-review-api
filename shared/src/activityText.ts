// Wording for user-account and permission changes, shared so the activity log reads the same everywhere.
import type { EDITABLE_PERMS, PermissionMatrix, STAFF_ROLES } from './roles.js';

export interface UserLike {
  name: string;
  username: string;
  role: string;
  active: boolean;
  email?: string;
}

export function describeUserChange(before: UserLike, after: UserLike, passwordReset: boolean): string[] {
  const out: string[] = [];
  if (after.name !== before.name) out.push(`Renamed ${before.name} to ${after.name}`);
  if (after.role !== before.role) out.push(`Changed ${after.name}’s role from ${before.role} to ${after.role}`);
  if (after.active !== before.active) out.push(`${after.active ? 'Reactivated' : 'Deactivated'} ${after.name} (${after.username})`);
  if ((after.email ?? '') !== (before.email ?? ''))
    out.push(
      after.email
        ? `${before.email ? 'Changed' : 'Set'} ${after.name}’s email address to ${after.email}`
        : `Removed ${after.name}’s email address`
    );
  if (passwordReset) out.push(`Reset the password for ${after.name} (${after.username})`);
  return out;
}

/** One line per change to the permission matrix. */
export function describeMatrixChange(
  before: PermissionMatrix,
  after: PermissionMatrix,
  perms: typeof EDITABLE_PERMS,
  roles: typeof STAFF_ROLES
): string[] {
  const out: string[] = [];
  for (const p of perms)
    for (const r of roles) {
      const was = before[p.id]?.includes(r),
        now = after[p.id]?.includes(r);
      if (was !== now) out.push(`${now ? 'Granted' : 'Removed'} ${r}: ${p.label}`);
    }
  return out;
}
