import type { EntityRecord, EntityRepository } from '../../../application/ports/EntityRepository.js';
import { entityNameKey, type EntityDocument } from '../../../domain/review/Entity.js';
import type { Db } from '../prisma.js';

type Row = NonNullable<Awaited<ReturnType<Db['entity']['findUnique']>>>;

const toRecord = (r: Row): EntityRecord => ({
  doc: r.data as unknown as EntityDocument,
  createdBy: r.createdBy,
  createdAt: r.createdAt.toISOString(),
  updatedBy: r.updatedBy,
  updatedAt: r.updatedAt.toISOString()
});

const toRow = (rec: EntityRecord) => ({
  name: rec.doc.name,
  nameKey: entityNameKey(rec.doc.name),
  clientName: String(rec.doc.client ?? ''),
  framework: String(rec.doc.framework ?? ''),
  aiPermitted: typeof rec.doc.aiPermitted === 'boolean' ? rec.doc.aiPermitted : null,
  data: JSON.parse(JSON.stringify(rec.doc)),
  createdBy: rec.createdBy,
  createdAt: new Date(rec.createdAt),
  updatedBy: rec.updatedBy,
  updatedAt: new Date(rec.updatedAt)
});

export class PrismaEntityRepository implements EntityRepository {
  constructor(private readonly db: Db) {}

  async list(): Promise<EntityRecord[]> {
    return (await this.db.entity.findMany({ orderBy: { name: 'asc' } })).map(toRecord);
  }
  async findById(id: string): Promise<EntityRecord | null> {
    const r = await this.db.entity.findUnique({ where: { id } });
    return r ? toRecord(r) : null;
  }
  async findByNameKey(nameKey: string): Promise<EntityRecord | null> {
    const r = await this.db.entity.findUnique({ where: { nameKey } });
    return r ? toRecord(r) : null;
  }
  async create(rec: EntityRecord): Promise<void> {
    await this.db.entity.create({ data: { id: rec.doc.id, ...toRow(rec) } });
  }
  async update(rec: EntityRecord): Promise<void> {
    await this.db.entity.update({ where: { id: rec.doc.id }, data: toRow(rec) });
  }
}
