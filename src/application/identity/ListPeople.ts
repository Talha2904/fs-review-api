import type { PermissionMatrix, Role } from '@fs-review/shared';

import type { Actor } from '../../domain/identity/User.js';
import type { UserRepository } from '../ports/UserRepository.js';

import { requirePermission } from './authorize.js';

export interface Person {
  id: string;
  name: string;
  role: Role;
  active: boolean;
}

/** Names and roles only, for choosing preparers, reviewers, managers and partners. Any signed-in user. */
export class ListPeople {
  constructor(private readonly users: UserRepository) {}

  async execute(actor: Actor | null, matrix: PermissionMatrix): Promise<Person[]> {
    requirePermission(actor, 'activity.write', matrix);
    return (await this.users.list()).map((u) => ({ id: u.id, name: u.name, role: u.role, active: u.active }));
  }
}
