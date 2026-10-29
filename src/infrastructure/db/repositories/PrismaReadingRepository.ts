import type { DocumentReading, ReadingRepository } from '../../../application/ports/ReadingRepository.js';
import type { Person } from '../../../domain/review/Document.js';
import type { Db } from '../prisma.js';

type Row = NonNullable<Awaited<ReturnType<Db['documentReading']['findUnique']>>>;

const toDomain = (r: Row): DocumentReading => ({
  key: r.key,
  slot: r.slot,
  sha256: r.sha256,
  model: r.model,
  reading: r.reading,
  readBy: (r.readBy as Person | null) ?? null,
  readAt: r.readAt.toISOString()
});

const plain = (v: unknown) => JSON.parse(JSON.stringify(v ?? null));

export class PrismaReadingRepository implements ReadingRepository {
  constructor(private readonly db: Db) {}

  async get(key: string): Promise<DocumentReading | null> {
    const r = await this.db.documentReading.findUnique({ where: { key } });
    return r ? toDomain(r) : null;
  }
  async findBySha256(sha256s: string[]): Promise<DocumentReading[]> {
    if (!sha256s.length) return [];
    return (await this.db.documentReading.findMany({ where: { sha256: { in: sha256s } } })).map(toDomain);
  }
  async save(r: DocumentReading): Promise<void> {
    const data = {
      slot: r.slot,
      sha256: r.sha256,
      model: r.model,
      reading: plain(r.reading),
      readBy: plain(r.readBy),
      readAt: new Date(r.readAt)
    };
    await this.db.documentReading.upsert({ where: { key: r.key }, create: { key: r.key, ...data }, update: data });
  }
}
