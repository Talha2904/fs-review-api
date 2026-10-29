import { LOGIN_WINDOW_MS, type LoginThrottle } from '../../../application/ports/LoginThrottle.js';
import type { Db } from '../prisma.js';

/**
 * One row per key. A finished window is restarted, then the count is upserted with an atomic increment
 * (count = count + 1 in SQL, portable), so parallel attempts each see their own number.
 */
export class PrismaLoginThrottle implements LoginThrottle {
  constructor(private readonly db: Db) {}

  async hit(key: string, now: string): Promise<{ count: number }> {
    const t = new Date(now);
    await this.db.loginAttempt.updateMany({
      where: { key, firstAt: { lt: new Date(t.getTime() - LOGIN_WINDOW_MS) } },
      data: { count: 0, firstAt: t }
    });
    const row = await this.db.loginAttempt.upsert({
      where: { key },
      create: { key, count: 1, firstAt: t },
      update: { count: { increment: 1 } }
    });
    return { count: row.count };
  }

  async clear(key: string): Promise<void> {
    await this.db.loginAttempt.deleteMany({ where: { key } });
  }
}
