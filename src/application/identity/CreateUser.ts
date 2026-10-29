import { cleanUsername, type PermissionMatrix, type Role } from '@fs-review/shared';

import { validationFailed } from '../../domain/errors.js';
import { publicUser, type Actor, type PublicUser, type User } from '../../domain/identity/User.js';
import type { ActivityRecorder } from '../activity/ActivityRecorder.js';
import type { Clock } from '../ports/Clock.js';
import type { IdGenerator } from '../ports/IdGenerator.js';
import type { PasswordHasher } from '../ports/PasswordHasher.js';
import type { UserRepository } from '../ports/UserRepository.js';

import { requirePermission } from './authorize.js';
import { cleanEmail, newUserProblem, type NewUserInput } from './userValidation.js';

export class CreateUser {
  constructor(
    private readonly users: UserRepository,
    private readonly hasher: PasswordHasher,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly activity: ActivityRecorder
  ) {}

  async execute(actor: Actor | null, matrix: PermissionMatrix, input: NewUserInput, ip?: string): Promise<PublicUser> {
    const by = requirePermission(actor, 'users.manage', matrix);
    const all = await this.users.list();
    const problem = newUserProblem(input, all);
    if (problem) throw validationFailed(problem);
    const { hash, salt } = await this.hasher.hash(input.password as string);
    const user: User = {
      id: this.ids.next(),
      name: String(input.name).trim(),
      username: cleanUsername(input.username),
      email: cleanEmail(input.email),
      role: input.role as Role,
      active: true,
      passwordHash: hash,
      passwordSalt: salt,
      createdAt: this.clock.nowIso(),
      lastSignInAt: null,
      passwordChangedAt: null
    };
    await this.users.create(user);
    await this.activity.record({
      actor: by,
      category: 'Users',
      summary: `Added ${user.name} (${user.username}) as ${user.role}`,
      ip: ip ?? ''
    });
    return publicUser(user);
  }
}
