import { cleanUsername } from '@fs-review/shared';

import { AppError, unauthenticated } from '../../domain/errors.js';
import { actorOf, publicUser, type PublicUser } from '../../domain/identity/User.js';
import type { ActivityRecorder } from '../activity/ActivityRecorder.js';
import type { Clock } from '../ports/Clock.js';
import type { IdGenerator } from '../ports/IdGenerator.js';
import { LOGIN_MAX_ATTEMPTS, LOGIN_MAX_PER_USERNAME, type LoginThrottle } from '../ports/LoginThrottle.js';
import type { PasswordHasher } from '../ports/PasswordHasher.js';
import type { SessionRepository } from '../ports/SessionRepository.js';
import type { Tokens } from '../ports/Tokens.js';
import type { UserRepository } from '../ports/UserRepository.js';

import { SESSION_HOURS } from './ResolveSession.js';

/** Opens a session for a user and returns the cookie token. Only the token's fingerprint is stored. */
export class StartSession {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly tokens: Tokens,
    private readonly ids: IdGenerator,
    private readonly clock: Clock
  ) {}

  async execute(userId: string, ip?: string): Promise<string> {
    const token = this.tokens.secret();
    const now = this.clock.now();
    await this.sessions.create({
      id: this.ids.next(),
      tokenHash: this.tokens.fingerprint(token),
      userId,
      ip: ip ?? null,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + SESSION_HOURS * 3600e3).toISOString(),
      revokedAt: null
    });
    return token;
  }
}

export interface SignInInput {
  username: string;
  password: string;
  ip?: string;
}

export class SignIn {
  constructor(
    private readonly users: UserRepository,
    private readonly hasher: PasswordHasher,
    private readonly throttle: LoginThrottle,
    private readonly startSession: StartSession,
    private readonly activity: ActivityRecorder,
    private readonly clock: Clock
  ) {}

  private dummyHash: Promise<{ hash: string; salt: string }> | null = null;
  private dummy() {
    return (this.dummyHash ??= this.hasher.hash('not-a-password-' + Math.random()));
  }

  async execute(input: SignInInput): Promise<{ user: PublicUser; token: string }> {
    const username = cleanUsername(input.username);
    const ip = input.ip ?? '';
    const key = `${ip}|${username}`,
      userKey = `user|${username}`;
    const now = this.clock.nowIso();
    const here = (await this.throttle.hit(key, now)).count,
      anywhere = (await this.throttle.hit(userKey, now)).count;
    if (here > LOGIN_MAX_ATTEMPTS || anywhere > LOGIN_MAX_PER_USERNAME) {
      // logged once per window, so a flood of attempts cannot flood the log
      if (here === LOGIN_MAX_ATTEMPTS + 1 || anywhere === LOGIN_MAX_PER_USERNAME + 1)
        await this.activity.record({
          actor: null,
          category: 'Sign-in',
          summary: `Sign-in blocked after repeated failures for “${username}”`,
          ip
        });
      throw new AppError('RATE_LIMITED', 'Too many attempts. Wait 15 minutes and try again.');
    }
    const u = await this.users.findByUsername(username);
    // an unknown username costs the same time as a wrong password, so timing does not reveal who exists
    const stored = u ? { hash: u.passwordHash, salt: u.passwordSalt } : await this.dummy();
    const ok = (await this.hasher.verify(input.password, stored)) && !!u && u.active;
    if (!u || !ok) {
      await this.activity.record({
        actor: u && u.active ? actorOf(u) : null,
        category: 'Sign-in',
        summary: `Failed sign-in for “${username}”`,
        details: !u ? 'No such user' : !u.active ? 'Account deactivated' : 'Wrong password',
        ip
      });
      throw unauthenticated('The username or password is not correct.');
    }
    await this.throttle.clear(key);
    await this.throttle.clear(userKey);
    const signedIn = { ...u, lastSignInAt: this.clock.nowIso() };
    await this.users.update(signedIn);
    const token = await this.startSession.execute(u.id, ip);
    await this.activity.record({ actor: actorOf(u), category: 'Sign-in', summary: 'Signed in', ip });
    return { user: publicUser(signedIn), token };
  }
}
