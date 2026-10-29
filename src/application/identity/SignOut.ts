import type { Actor } from '../../domain/identity/User.js';
import type { ActivityRecorder } from '../activity/ActivityRecorder.js';
import type { Clock } from '../ports/Clock.js';
import type { SessionRepository } from '../ports/SessionRepository.js';
import type { Tokens } from '../ports/Tokens.js';

export class SignOut {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly tokens: Tokens,
    private readonly clock: Clock,
    private readonly activity: ActivityRecorder
  ) {}

  async execute(actor: Actor | null, token: string | undefined, ip?: string): Promise<void> {
    if (token) await this.sessions.revoke(this.tokens.fingerprint(token), this.clock.nowIso());
    if (actor) await this.activity.record({ actor, category: 'Sign-in', summary: 'Signed out', ip: ip ?? '' });
  }
}
