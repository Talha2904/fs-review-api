import type { Session, SessionRepository } from '../../../application/ports/SessionRepository.js';
import type { Db } from '../prisma.js';

export class PrismaSessionRepository implements SessionRepository {
  constructor(private readonly db: Db) {}

  async create(s: Session): Promise<void> {
    await this.db.session.create({
      data: {
        id: s.id,
        tokenHash: s.tokenHash,
        userId: s.userId,
        ip: s.ip,
        createdAt: new Date(s.createdAt),
        expiresAt: new Date(s.expiresAt),
        revokedAt: null
      }
    });
  }

  async findActive(tokenHash: string, now: string): Promise<Session | null> {
    const r = await this.db.session.findUnique({ where: { tokenHash } });
    if (!r || r.revokedAt || r.expiresAt.getTime() <= new Date(now).getTime()) return null;
    return {
      id: r.id,
      tokenHash: r.tokenHash,
      userId: r.userId,
      ip: r.ip,
      createdAt: r.createdAt.toISOString(),
      expiresAt: r.expiresAt.toISOString(),
      revokedAt: null
    };
  }

  async revoke(tokenHash: string, at: string): Promise<void> {
    await this.db.session.updateMany({ where: { tokenHash, revokedAt: null }, data: { revokedAt: new Date(at) } });
  }

  async revokeAllForUser(userId: string, at: string): Promise<void> {
    await this.db.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date(at) } });
  }

  async revokeOthersForUser(userId: string, keepTokenHash: string, at: string): Promise<void> {
    await this.db.session.updateMany({
      where: { userId, revokedAt: null, NOT: { tokenHash: keepTokenHash } },
      data: { revokedAt: new Date(at) }
    });
  }

  async deleteExpired(before: string): Promise<number> {
    const r = await this.db.session.deleteMany({ where: { expiresAt: { lt: new Date(before) } } });
    return r.count;
  }
}
