import { actorOf, type Actor } from '../../domain/identity/User.js';
import type { Clock } from '../ports/Clock.js';
import type { SessionRepository } from '../ports/SessionRepository.js';
import type { Tokens } from '../ports/Tokens.js';
import type { UserRepository } from '../ports/UserRepository.js';

export const SESSION_HOURS = 12;

/** Turns the cookie token into the acting user, or null. Deactivated users have no session. */
export class ResolveSession {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly users: UserRepository,
    private readonly tokens: Tokens,
    private readonly clock: Clock
  ) {}

  async execute(token: string | undefined): Promise<Actor | null> {
    if (!token) return null;
    const s = await this.sessions.findActive(this.tokens.fingerprint(token), this.clock.nowIso());
    if (!s) return null;
    const u = await this.users.findById(s.userId);
    return u && u.active ? actorOf(u) : null;
  }
}
