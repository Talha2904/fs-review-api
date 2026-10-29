import { can, type Permission, type PermissionMatrix } from '@fs-review/shared';

import { forbidden, unauthenticated } from '../../domain/errors.js';
import type { Actor } from '../../domain/identity/User.js';

/** Throws unless the actor holds the permission under the matrix. Every write use case calls this first. */
export function requirePermission(actor: Actor | null, permission: Permission, matrix: PermissionMatrix): Actor {
  if (!actor) throw unauthenticated();
  if (!can(actor, permission, matrix)) throw forbidden(`The ${actor.role} role cannot do this.`);
  return actor;
}

/** Throws unless the actor holds at least one of the permissions. */
export function requireAnyPermission(actor: Actor | null, permissions: Permission[], matrix: PermissionMatrix, message?: string): Actor {
  if (!actor) throw unauthenticated();
  if (!permissions.some((p) => can(actor, p, matrix))) throw forbidden(message ?? `The ${actor.role} role cannot do this.`);
  return actor;
}
