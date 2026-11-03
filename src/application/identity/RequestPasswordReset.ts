import { AppError } from '../../domain/errors.js';
import { actorOf } from '../../domain/identity/User.js';
import type { ActivityRecorder } from '../activity/ActivityRecorder.js';
import { passwordResetEmail } from '../mail/emailLayout.js';
import type { Clock } from '../ports/Clock.js';
import type { IdGenerator } from '../ports/IdGenerator.js';
import type { Logger } from '../ports/Logger.js';
import type { Mailer } from '../ports/Mailer.js';
import type { PasswordResetRepository } from '../ports/PasswordResetRepository.js';
import type { Tokens } from '../ports/Tokens.js';
import type { UserRepository } from '../ports/UserRepository.js';

export const RESET_MINUTES = 30;
export const SAME_ANSWER = 'If an account matches, we’ve emailed a link to reset the password. It works once and expires in 30 minutes.';

/** Per-hour request limits so the form cannot be used to spam or to probe which accounts exist. */
export class ResetRequestLimiter {
  private readonly recent = new Map<string, number[]>();
  tooMany(key: string, max: number, nowMs: number): boolean {
    const list = (this.recent.get(key) || []).filter((t) => nowMs - t < 3600e3);
    list.push(nowMs);
    this.recent.set(key, list);
    return list.length > max;
  }
}

/**
 * Emails a one-time reset link. The answer is always the same whether or not an account matches.
 * The link is built from APP_URL, never from the request, so a forged Host header cannot redirect it.
 */
export class RequestPasswordReset {
  constructor(
    private readonly users: UserRepository,
    private readonly resets: PasswordResetRepository,
    private readonly mailer: Mailer,
    private readonly tokens: Tokens,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly activity: ActivityRecorder,
    private readonly logger: Logger,
    private readonly appUrl: string,
    private readonly limiter: ResetRequestLimiter = new ResetRequestLimiter()
  ) {}

  async execute(login: string, ip: string): Promise<{ ok: true; message: string }> {
    if (!this.mailer.configured || !this.appUrl)
      throw new AppError('AI_UNAVAILABLE', 'Password reset by email isn’t set up. Ask an Administrator to reset your password.');
    const same = { ok: true as const, message: SAME_ANSWER };
    const key = String(login || '')
      .trim()
      .toLowerCase();
    const nowMs = this.clock.now().getTime();
    if (!key || this.limiter.tooMany(`ip:${ip}`, 10, nowMs)) return same;
    const u = await this.users.findByLogin(key);
    if (!u || !u.active || !u.email || this.limiter.tooMany(`user:${u.id}`, 3, nowMs)) return same;
    const secret = this.tokens.secret();
    const expiresAt = new Date(nowMs + RESET_MINUTES * 60e3).toISOString();
    await this.resets.create({
      id: this.ids.next(),
      tokenHash: this.tokens.fingerprint(secret),
      userId: u.id,
      createdAt: new Date(nowMs).toISOString(),
      expiresAt,
      usedAt: null
    });
    const link = `${this.appUrl.replace(/\/$/, '')}/?reset=${secret}`;
    try {
      await this.mailer.send({
        to: u.email,
        ...passwordResetEmail({ name: u.name, username: u.username, link, expiresAt, minutes: RESET_MINUTES })
      });
      await this.activity.record({
        actor: actorOf(u),
        category: 'Users',
        summary: 'Asked for a password reset link',
        details: `Sent to ${u.email}`,
        ip
      });
    } catch (e) {
      this.logger.error({ err: e }, 'Password reset email failed');
    }
    return same;
  }
}
