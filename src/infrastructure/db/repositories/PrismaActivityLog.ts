import { Prisma } from '@prisma/client';

import type { ActivityLog, ActivityQuery, UsageRow } from '../../../application/ports/ActivityLog.js';
import type { ActivityEntry, AiUsageRecord } from '../../../domain/activity/ActivityEntry.js';
import type { Db } from '../prisma.js';

type Row = NonNullable<Awaited<ReturnType<Db['activityEntry']['findFirst']>>>;

const toDomain = (r: Row): ActivityEntry => ({
  id: r.id,
  at: r.at.toISOString(),
  actor: r.actorId ? { id: r.actorId, name: r.actorName ?? '', username: r.actorUsername ?? '', role: r.actorRole ?? '' } : null,
  category: r.category,
  summary: r.summary,
  details: r.details,
  ip: r.ip,
  engagementId: r.engagementId,
  fundName: r.fundName,
  ...(r.usage ? { usage: r.usage as unknown as AiUsageRecord } : {})
});

/** Append-only: this class has no update or delete method, and the application never gets one. */
export class PrismaActivityLog implements ActivityLog {
  constructor(private readonly db: Db) {}

  async append(e: ActivityEntry): Promise<void> {
    await this.db.activityEntry.create({
      data: {
        id: e.id,
        at: new Date(e.at),
        actorId: e.actor?.id ?? null,
        actorName: e.actor?.name ?? null,
        actorUsername: e.actor?.username ?? null,
        actorRole: e.actor?.role ?? null,
        category: e.category,
        summary: e.summary,
        details: e.details,
        ip: e.ip,
        engagementId: e.engagementId,
        fundName: e.fundName,
        ...(e.usage ? { usage: { ...e.usage } } : {})
      }
    });
  }

  async list(q: ActivityQuery): Promise<ActivityEntry[]> {
    const rows = await this.db.activityEntry.findMany({
      ...(q.engagementId ? { where: { engagementId: q.engagementId } } : {}),
      orderBy: { at: 'desc' },
      take: Math.max(1, Math.min(20000, q.limit))
    });
    return rows.map(toDomain);
  }

  async usage(): Promise<UsageRow[]> {
    const rows = await this.db.activityEntry.findMany({
      where: { usage: { not: Prisma.DbNull }, engagementId: { not: null } },
      orderBy: { at: 'asc' }
    });
    return rows
      .filter((r) => r.usage && r.engagementId)
      .map((r) => {
        const u = r.usage as unknown as AiUsageRecord;
        return {
          id: r.id,
          at: r.at.toISOString(),
          engagementId: r.engagementId as string,
          fundName: r.fundName ?? '',
          step: u.step,
          model: u.model,
          input: u.input,
          output: u.output
        };
      });
  }
}
