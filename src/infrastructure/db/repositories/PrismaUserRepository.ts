import type { Role } from '@fs-review/shared';

import type { UserRepository } from '../../../application/ports/UserRepository.js';
import type { User } from '../../../domain/identity/User.js';
import type { Db } from '../prisma.js';

type Row = NonNullable<Awaited<ReturnType<Db['user']['findUnique']>>>;

const toDomain = (r: Row): User => ({
  id: r.id,
  name: r.name,
  username: r.username,
  email: r.email ?? '',
  role: r.role as Role,
  active: r.active,
  passwordHash: r.passwordHash,
  passwordSalt: r.passwordSalt,
  createdAt: r.createdAt.toISOString(),
  lastSignInAt: r.lastSignInAt ? r.lastSignInAt.toISOString() : null,
  passwordChangedAt: r.passwordChangedAt ? r.passwordChangedAt.toISOString() : null
});

const toRow = (u: User) => ({
  name: u.name,
  username: u.username,
  email: u.email || null,
  emailKey: u.email ? u.email.toLowerCase() : null,
  role: u.role,
  active: u.active,
  passwordHash: u.passwordHash,
  passwordSalt: u.passwordSalt,
  createdAt: new Date(u.createdAt),
  lastSignInAt: u.lastSignInAt ? new Date(u.lastSignInAt) : null,
  passwordChangedAt: u.passwordChangedAt ? new Date(u.passwordChangedAt) : null
});

export class PrismaUserRepository implements UserRepository {
  constructor(private readonly db: Db) {}

  async findById(id: string): Promise<User | null> {
    const r = await this.db.user.findUnique({ where: { id } });
    return r ? toDomain(r) : null;
  }
  async findByUsername(username: string): Promise<User | null> {
    const r = await this.db.user.findUnique({ where: { username } });
    return r ? toDomain(r) : null;
  }
  async findByEmail(email: string): Promise<User | null> {
    const r = await this.db.user.findUnique({ where: { emailKey: email.toLowerCase() } });
    return r ? toDomain(r) : null;
  }
  async findByLogin(login: string): Promise<User | null> {
    return (await this.findByUsername(login)) ?? (await this.findByEmail(login));
  }
  async list(): Promise<User[]> {
    const rows = await this.db.user.findMany({ orderBy: { createdAt: 'asc' } });
    return rows.map(toDomain);
  }
  count(): Promise<number> {
    return this.db.user.count();
  }
  async create(user: User): Promise<void> {
    await this.db.user.create({ data: { id: user.id, ...toRow(user) } });
  }
  /** Serializable, so two first-run set-ups at once cannot both see an empty table (portable to MySQL). */
  async createFirst(user: User): Promise<boolean> {
    try {
      return await this.db.$transaction(
        async (tx) => {
          if ((await tx.user.count()) > 0) return false;
          await tx.user.create({ data: { id: user.id, ...toRow(user) } });
          return true;
        },
        { isolationLevel: 'Serializable' }
      );
    } catch (e) {
      if ((e as { code?: string }).code === 'P2034' || (e as { code?: string }).code === 'P2002') return false; // lost the race
      throw e;
    }
  }

  async update(user: User): Promise<void> {
    await this.db.user.update({ where: { id: user.id }, data: toRow(user) });
  }
}
