import { passwordProblem } from '@fs-review/shared';

import { validationFailed } from '../../domain/errors.js';
import { actorOf } from '../../domain/identity/User.js';
import type { ActivityRecorder } from '../activity/ActivityRecorder.js';
import type { Clock } from '../ports/Clock.js';
import type { PasswordHasher } from '../ports/PasswordHasher.js';
import type { PasswordResetRepository } from '../ports/PasswordResetRepository.js';
import type { SessionRepository } from '../ports/SessionRepository.js';
import type { Tokens } from '../ports/Tokens.js';
import type { UserRepository } from '../ports/UserRepository.js';

const INVALID = 'This reset link is invalid or has expired. Ask for a new one.';

/** Uses an emailed link once; ends every other sign-in of that person. */
export class ResetPassword {
  constructor(
    private readonly users: UserRepository,
    private readonly resets: PasswordResetRepository,
    private readonly sessions: SessionRepository,
    private readonly hasher: PasswordHasher,
    private readonly tokens: Tokens,
    private readonly clock: Clock,
    private readonly activity: ActivityRecorder
  ) {}

  async execute(token: string, password: string, ip: string): Promise<void> {
    const problem = passwordProblem(password || '');
    if (problem) throw validationFailed(problem);
    const now = this.clock.nowIso();
    const r = await this.resets.findByTokenHash(this.tokens.fingerprint(token || ''));
    const u = r ? await this.users.findById(r.userId) : null;
    if (!r || r.usedAt || r.expiresAt < now || !u || !u.active) throw validationFailed(INVALID);
    // claimed before anything changes, so two requests with the same link cannot both succeed
    if (!(await this.resets.markUsed(r.id, now))) throw validationFailed(INVALID);
    const { hash, salt } = await this.hasher.hash(password);
    await this.users.update({ ...u, passwordHash: hash, passwordSalt: salt, passwordChangedAt: now });
    await this.sessions.revokeAllForUser(u.id, now);
    await this.activity.record({
      actor: actorOf(u),
      category: 'Users',
      summary: 'Reset their password with an emailed link',
      details: 'All their other sign-ins were ended',
      ip
    });
  }
}
