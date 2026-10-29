import { cleanUsername } from '@fs-review/shared';

import { conflict, validationFailed } from '../../domain/errors.js';
import { actorOf, publicUser, type PublicUser, type User } from '../../domain/identity/User.js';
import type { ActivityRecorder } from '../activity/ActivityRecorder.js';
import type { Clock } from '../ports/Clock.js';
import type { IdGenerator } from '../ports/IdGenerator.js';
import type { PasswordHasher } from '../ports/PasswordHasher.js';
import type { UserRepository } from '../ports/UserRepository.js';

import type { StartSession } from './SignIn.js';
import { cleanEmail, newUserProblem } from './userValidation.js';

export interface SetupInput {
  name: string;
  username: string;
  password: string;
  email?: string;
  ip?: string;
}

/** First run only: creates the first Administrator and signs them in. */
export class SetupFirstAdmin {
  constructor(
    private readonly users: UserRepository,
    private readonly hasher: PasswordHasher,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly activity: ActivityRecorder,
    private readonly startSession: StartSession
  ) {}

  async execute(input: SetupInput): Promise<{ user: PublicUser; token: string }> {
    if ((await this.users.count()) > 0) throw conflict('The administrator account already exists. Sign in instead.');
    const problem = newUserProblem({ ...input, role: 'Administrator' }, []);
    if (problem) throw validationFailed(problem);
    const { hash, salt } = await this.hasher.hash(input.password);
    const now = this.clock.nowIso();
    const user: User = {
      id: this.ids.next(),
      name: input.name.trim(),
      username: cleanUsername(input.username),
      email: cleanEmail(input.email),
      role: 'Administrator',
      active: true,
      passwordHash: hash,
      passwordSalt: salt,
      createdAt: now,
      lastSignInAt: now,
      passwordChangedAt: null
    };
    if (!(await this.users.createFirst(user))) throw conflict('The administrator account already exists. Sign in instead.');
    const token = await this.startSession.execute(user.id, input.ip);
    await this.activity.record({
      actor: actorOf(user),
      category: 'Users',
      summary: 'Created the first Administrator account',
      ip: input.ip ?? ''
    });
    return { user: publicUser(user), token };
  }
}
