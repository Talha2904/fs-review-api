import type { PasswordReset, PasswordResetRepository } from '../../../application/ports/PasswordResetRepository.js';
import type { Db } from '../prisma.js';

export class PrismaPasswordResetRepository implements PasswordResetRepository {
  constructor(private readonly db: Db) {}

  async create(r: PasswordReset): Promise<void> {
    await this.db.$transaction([
      this.db.passwordReset.deleteMany({ where: { userId: r.userId, usedAt: null } }),
      this.db.passwordReset.create({
        data: {
          id: r.id,
          tokenHash: r.tokenHash,
          userId: r.userId,
          createdAt: new Date(r.createdAt),
          expiresAt: new Date(r.expiresAt),
          usedAt: null
        }
      })
    ]);
  }

  async findByTokenHash(tokenHash: string): Promise<PasswordReset | null> {
    const r = await this.db.passwordReset.findUnique({ where: { tokenHash } });
    return r
      ? {
          id: r.id,
          tokenHash: r.tokenHash,
          userId: r.userId,
          createdAt: r.createdAt.toISOString(),
          expiresAt: r.expiresAt.toISOString(),
          usedAt: r.usedAt ? r.usedAt.toISOString() : null
        }
      : null;
  }

  async markUsed(id: string, at: string): Promise<boolean> {
    const r = await this.db.passwordReset.updateMany({ where: { id, usedAt: null }, data: { usedAt: new Date(at) } });
    return r.count === 1;
  }

  async deleteUnusedForUser(userId: string): Promise<void> {
    await this.db.passwordReset.deleteMany({ where: { userId, usedAt: null } });
  }
}
