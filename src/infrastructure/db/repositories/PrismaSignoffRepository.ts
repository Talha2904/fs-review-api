import type { SignoffState } from '@fs-review/shared';

import type { Signoff, SignoffEntry, SignoffRepository } from '../../../application/ports/SignoffRepository.js';
import type { Person } from '../../../domain/review/Document.js';
import type { Db } from '../prisma.js';

type Row = NonNullable<Awaited<ReturnType<Db['signoff']['findUnique']>>>;

const toDomain = (r: Row): Signoff => ({
  engagementId: r.engagementId,
  state: r.state as SignoffState,
  by: (r.by as Person | null) ?? null,
  at: r.at ? r.at.toISOString() : null,
  text: r.text,
  summary: r.summary ?? null,
  history: (r.history as unknown as SignoffEntry[]) ?? []
});

const plain = (v: unknown) => JSON.parse(JSON.stringify(v ?? null));

export class PrismaSignoffRepository implements SignoffRepository {
  constructor(private readonly db: Db) {}

  async get(engagementId: string): Promise<Signoff | null> {
    const r = await this.db.signoff.findUnique({ where: { engagementId } });
    return r ? toDomain(r) : null;
  }
  async listAll(): Promise<Signoff[]> {
    return (await this.db.signoff.findMany()).map(toDomain);
  }
  async save(s: Signoff): Promise<void> {
    const data = {
      state: s.state,
      by: plain(s.by),
      at: s.at ? new Date(s.at) : null,
      text: s.text,
      summary: plain(s.summary),
      history: plain(s.history)
    };
    await this.db.signoff.upsert({
      where: { engagementId: s.engagementId },
      create: { engagementId: s.engagementId, ...data },
      update: data
    });
  }
}
