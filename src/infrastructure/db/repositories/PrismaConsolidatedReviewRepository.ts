import { Prisma } from '@prisma/client';

import type {
  ConsolidatedReviewRecord,
  ConsolidatedReviewRepository,
  ConsolidatedStatus
} from '../../../application/ports/ConsolidatedReviewRepository.js';
import type { Person } from '../../../domain/review/Document.js';
import type { Db } from '../prisma.js';

type Row = NonNullable<Awaited<ReturnType<Db['consolidatedReview']['findFirst']>>>;

const MAX_ATTEMPTS = 8;
// JSON columns: written whole, as plain JSON (a missing result is stored as SQL NULL)
const plain = (v: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(v ?? null)) as Prisma.InputJsonValue;
const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);
const date = (s: string | null): Date | null => (s ? new Date(s) : null);

const toDomain = (r: Row): ConsolidatedReviewRecord => ({
  id: r.id,
  groupKey: r.groupKey,
  groupName: r.groupName,
  yearEnd: r.yearEnd,
  status: r.status as ConsolidatedStatus,
  step: r.step,
  total: r.total,
  error: r.error,
  runIds: (r.runIds ?? {}) as Record<string, string | null>,
  result: (r.result ?? null) as Record<string, unknown> | null,
  requestedBy: r.requestedBy as unknown as Person,
  createdAt: r.createdAt.toISOString(),
  startedAt: iso(r.startedAt),
  finishedAt: iso(r.finishedAt)
});

const data = (r: ConsolidatedReviewRecord) => ({
  groupKey: r.groupKey,
  groupName: r.groupName,
  yearEnd: r.yearEnd,
  status: r.status,
  step: r.step,
  total: r.total,
  error: r.error,
  runIds: plain(r.runIds),
  result: r.result === null ? Prisma.DbNull : plain(r.result),
  requestedBy: { id: r.requestedBy.id, name: r.requestedBy.name, role: r.requestedBy.role },
  createdAt: new Date(r.createdAt),
  startedAt: date(r.startedAt),
  finishedAt: date(r.finishedAt)
});

export class PrismaConsolidatedReviewRepository implements ConsolidatedReviewRepository {
  constructor(private readonly db: Db) {}

  /** Serializable with retries, as for analysis jobs, so two starts at once cannot both find the group idle. */
  async createIfIdle(r: ConsolidatedReviewRecord): Promise<boolean> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.db.$transaction(
          async (tx) => {
            const busy = await tx.consolidatedReview.count({
              where: { groupKey: r.groupKey, yearEnd: r.yearEnd, status: { in: ['queued', 'running'] } }
            });
            if (busy) return false;
            await tx.consolidatedReview.create({ data: { id: r.id, ...data(r) } });
            return true;
          },
          { isolationLevel: 'Serializable' }
        );
      } catch (e) {
        if ((e as { code?: string }).code === 'P2034' && attempt < MAX_ATTEMPTS) {
          await new Promise((res) => setTimeout(res, Math.random() * 20 * attempt));
          continue;
        }
        throw e;
      }
    }
  }

  async update(r: ConsolidatedReviewRecord): Promise<void> {
    await this.db.consolidatedReview.update({ where: { id: r.id }, data: data(r) });
  }

  async updateWhileRunning(r: ConsolidatedReviewRecord): Promise<boolean> {
    const { count } = await this.db.consolidatedReview.updateMany({ where: { id: r.id, status: 'running' }, data: data(r) });
    return count === 1;
  }

  async findById(id: string): Promise<ConsolidatedReviewRecord | null> {
    const r = await this.db.consolidatedReview.findUnique({ where: { id } });
    return r ? toDomain(r) : null;
  }

  async latest(groupKey: string, yearEnd: string): Promise<ConsolidatedReviewRecord | null> {
    const r = await this.db.consolidatedReview.findFirst({ where: { groupKey, yearEnd }, orderBy: { createdAt: 'desc' } });
    return r ? toDomain(r) : null;
  }

  async latestDone(groupKey: string, yearEnd: string): Promise<ConsolidatedReviewRecord | null> {
    const r = await this.db.consolidatedReview.findFirst({ where: { groupKey, yearEnd, status: 'done' }, orderBy: { createdAt: 'desc' } });
    return r ? toDomain(r) : null;
  }

  /** Portable: summaries only (no result), ordered by group then time, keeping the first row of each group. */
  async latestAll(): Promise<ConsolidatedReviewRecord[]> {
    const rows = await this.db.consolidatedReview.findMany({
      orderBy: [{ groupKey: 'asc' }, { yearEnd: 'asc' }, { createdAt: 'desc' }],
      omit: { result: true }
    });
    const seen = new Set<string>();
    return rows
      .filter((r) => {
        const k = `${r.groupKey}|${r.yearEnd}`;
        return !seen.has(k) && !!seen.add(k);
      })
      .map((r) => toDomain({ ...r, result: null } as Row));
  }

  async listByStatus(statuses: ConsolidatedStatus[]): Promise<ConsolidatedReviewRecord[]> {
    const rows = await this.db.consolidatedReview.findMany({ where: { status: { in: statuses } }, orderBy: { createdAt: 'asc' } });
    return rows.map(toDomain);
  }
}
