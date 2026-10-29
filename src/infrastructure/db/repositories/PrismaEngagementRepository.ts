import type { EngagementRecord, EngagementRepository } from '../../../application/ports/EngagementRepository.js';
import { engagementIndex, type EngagementDocument } from '../../../domain/review/Engagement.js';
import type { Db } from '../prisma.js';

type Row = NonNullable<Awaited<ReturnType<Db['engagement']['findUnique']>>>;

const toRecord = (r: Row): EngagementRecord => ({
  doc: r.data as unknown as EngagementDocument,
  createdBy: r.createdBy,
  createdAt: r.createdAt.toISOString(),
  updatedBy: r.updatedBy,
  updatedAt: r.updatedAt.toISOString()
});

const toRow = (rec: EngagementRecord) => ({
  ...engagementIndex(rec.doc),
  data: JSON.parse(JSON.stringify(rec.doc)),
  createdBy: rec.createdBy,
  createdAt: new Date(rec.createdAt),
  updatedBy: rec.updatedBy,
  updatedAt: new Date(rec.updatedAt)
});

export class PrismaEngagementRepository implements EngagementRepository {
  constructor(private readonly db: Db) {}

  async list(): Promise<EngagementRecord[]> {
    return (await this.db.engagement.findMany({ orderBy: [{ fundName: 'asc' }, { yearEnd: 'desc' }] })).map(toRecord);
  }
  async findById(id: string): Promise<EngagementRecord | null> {
    const r = await this.db.engagement.findUnique({ where: { id } });
    return r ? toRecord(r) : null;
  }
  async findDuplicate(
    entityId: string | null,
    fundName: string,
    yearEnd: string,
    exceptId: string | null
  ): Promise<EngagementRecord | null> {
    const rows = await this.db.engagement.findMany({ where: { entityId, yearEnd } });
    const key = fundName.toLowerCase().replace(/\s+/g, '');
    const hit = rows.find((r) => r.id !== exceptId && r.fundName.toLowerCase().replace(/\s+/g, '') === key);
    return hit ? toRecord(hit) : null;
  }
  async create(rec: EngagementRecord): Promise<void> {
    await this.db.engagement.create({ data: { id: rec.doc.id, ...toRow(rec) } });
  }
  async update(rec: EngagementRecord): Promise<void> {
    await this.db.engagement.update({ where: { id: rec.doc.id }, data: toRow(rec) });
  }
}
