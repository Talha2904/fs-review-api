import { Prisma } from '@prisma/client';

import type { EngagementDeletion, EngagementRecord, EngagementRepository } from '../../../application/ports/EngagementRepository.js';
import { conflict, notFound } from '../../../domain/errors.js';
import type { Person } from '../../../domain/review/Document.js';
import { engagementIndex, type EngagementDocument } from '../../../domain/review/Engagement.js';
import type { Db } from '../prisma.js';

type Row = NonNullable<Awaited<ReturnType<Db['engagement']['findUnique']>>>;

const MAX_ATTEMPTS = 8;

/** Only funds that are not deleted. Every ordinary read uses this. */
const LIVE = { deletedAt: null };

const toRecord = (r: Row): EngagementRecord => ({
  doc: r.data as unknown as EngagementDocument,
  createdBy: r.createdBy,
  createdAt: r.createdAt.toISOString(),
  updatedBy: r.updatedBy,
  updatedAt: r.updatedAt.toISOString()
});

const withDeletion = (r: Row): EngagementRecord => ({
  ...toRecord(r),
  deleted: r.deletedAt
    ? { at: r.deletedAt.toISOString(), by: (r.deletedBy as unknown as Person | null) ?? null, reason: r.deletedReason }
    : null
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
    return (await this.db.engagement.findMany({ where: LIVE, orderBy: [{ fundName: 'asc' }, { yearEnd: 'desc' }] })).map(toRecord);
  }
  async findById(id: string): Promise<EngagementRecord | null> {
    const r = await this.db.engagement.findFirst({ where: { id, ...LIVE } });
    return r ? toRecord(r) : null;
  }
  async findDuplicate(
    entityId: string | null,
    fundName: string,
    yearEnd: string,
    exceptId: string | null
  ): Promise<EngagementRecord | null> {
    const rows = await this.db.engagement.findMany({ where: { entityId, yearEnd, ...LIVE } });
    const key = fundName.toLowerCase().replace(/\s+/g, '');
    const hit = rows.find((r) => r.id !== exceptId && r.fundName.toLowerCase().replace(/\s+/g, '') === key);
    return hit ? toRecord(hit) : null;
  }
  async create(rec: EngagementRecord): Promise<void> {
    await this.db.engagement.create({ data: { id: rec.doc.id, ...toRow(rec) } });
  }
  /** Never changes a deleted fund: a save that reaches one after it was deleted is answered 404. */
  async update(rec: EngagementRecord): Promise<void> {
    const { count } = await this.db.engagement.updateMany({ where: { id: rec.doc.id, ...LIVE }, data: toRow(rec) });
    if (count !== 1) throw notFound('That engagement');
  }
  async findIncludingDeleted(id: string): Promise<EngagementRecord | null> {
    const r = await this.db.engagement.findUnique({ where: { id } });
    return r ? withDeletion(r) : null;
  }
  async listDeleted(): Promise<EngagementRecord[]> {
    return (await this.db.engagement.findMany({ where: { deletedAt: { not: null } }, orderBy: { deletedAt: 'desc' } })).map(withDeletion);
  }
  /**
   * Serializable, together with the check that no analysis of the fund is queued or running: a start at the same
   * moment (AnalysisJob createIfIdle, also serializable and reading the fund) and this delete cannot both succeed.
   * A conflict is retried; the loser then sees the other's result.
   */
  async markDeleted(id: string, d: EngagementDeletion): Promise<boolean> {
    const by = d.by ? { id: d.by.id, name: d.by.name, role: d.by.role } : Prisma.DbNull;
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.db.$transaction(
          async (tx) => {
            const busy = await tx.analysisJob.count({ where: { engagementId: id, status: { in: ['queued', 'running'] } } });
            if (busy) throw conflict('An analysis of this fund is running. Wait for it to finish, then delete the fund.');
            const { count } = await tx.engagement.updateMany({
              where: { id, ...LIVE },
              data: { deletedAt: new Date(d.at), deletedBy: by, deletedReason: d.reason }
            });
            return count === 1;
          },
          { isolationLevel: 'Serializable' }
        );
      } catch (e) {
        if ((e as { code?: string }).code === 'P2034' && attempt < MAX_ATTEMPTS) {
          await new Promise((r) => setTimeout(r, Math.random() * 20 * attempt));
          continue;
        }
        throw e;
      }
    }
  }
  async restore(id: string, updatedBy: string, at: string): Promise<boolean> {
    const { count } = await this.db.engagement.updateMany({
      where: { id, deletedAt: { not: null } },
      // the deletion is kept in the activity log; the row goes back to how it was
      data: { deletedAt: null, deletedBy: Prisma.DbNull, deletedReason: null, updatedBy, updatedAt: new Date(at) }
    });
    return count === 1;
  }
}
