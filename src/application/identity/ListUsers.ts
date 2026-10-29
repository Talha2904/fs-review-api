import type { PermissionMatrix } from '@fs-review/shared';

import { publicUser, type Actor, type PublicUser } from '../../domain/identity/User.js';
import type { UserRepository } from '../ports/UserRepository.js';

import { requirePermission } from './authorize.js';

/** The staff directory for Administrators. */
export class ListUsers {
  constructor(private readonly users: UserRepository) {}

  async execute(actor: Actor | null, matrix: PermissionMatrix): Promise<PublicUser[]> {
    requirePermission(actor, 'users.manage', matrix);
    return (await this.users.list()).map(publicUser);
  }
}
