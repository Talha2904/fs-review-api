import type { FundActivity, PortfolioReadModel } from '../../../application/ports/PortfolioReadModel.js';
import type { Db } from '../prisma.js';

const later = (...xs: (Date | null | undefined)[]): Date | null => xs.reduce<Date | null>((a, x) => (x && (!a || x > a) ? x : a), null);

/**
 * The portfolio from aggregate queries: GROUP BY counts of points per fund and status, the latest time per fund
 * for runs and messages, and only the few columns of document versions needed to know whether a slot is filled.
 * Portable SQL through Prisma (groupBy, _count, _max), no engine-specific functions.
 */
export class PrismaPortfolioReadModel implements PortfolioReadModel {
  constructor(private readonly db: Db) {}

  async activity(today: string): Promise<FundActivity[]> {
    const [versions, workflows, signoffs, byStatus, overdue, runs, messages] = await Promise.all([
      this.db.documentVersion.findMany({ select: { engagementId: true, slot: true, version: true, removedAt: true, uploadedAt: true } }),
      this.db.workflow.findMany({ select: { engagementId: true, state: true, at: true } }),
      this.db.signoff.findMany({ select: { engagementId: true, state: true, at: true } }),
      this.db.reviewPoint.groupBy({ by: ['engagementId', 'status'], _count: { _all: true } }),
      this.db.reviewPoint.groupBy({
        by: ['engagementId'],
        where: { status: { in: ['open', 'reopened', 'responded'] }, dueDate: { not: null, lt: today } },
        _count: { _all: true }
      }),
      this.db.analysisRun.groupBy({ by: ['engagementId'], _max: { at: true } }),
      this.db.pointMessage.groupBy({ by: ['engagementId'], _max: { at: true } })
    ]);

    const funds = new Map<string, FundActivity & { last: Date | null }>();
    const fund = (id: string) => {
      let f = funds.get(id);
      if (!f) {
        f = {
          engagementId: id,
          hasDocuments: false,
          workflowState: 'preparing',
          signoffState: 'none',
          analysed: false,
          openPoints: 0,
          respondedPoints: 0,
          overduePoints: 0,
          lastActivityAt: null,
          last: null
        };
        funds.set(id, f);
      }
      return f;
    };
    // a slot is filled when its latest version is not removed
    const latest = new Map<string, { version: number; removed: boolean }>();
    for (const v of versions) {
      const key = `${v.engagementId}|${v.slot}`;
      const cur = latest.get(key);
      if (!cur || v.version > cur.version) latest.set(key, { version: v.version, removed: !!v.removedAt });
      const f = fund(v.engagementId);
      f.last = later(f.last, v.uploadedAt);
    }
    for (const [key, v] of latest) if (!v.removed) fund(key.split('|')[0]!).hasDocuments = true;
    for (const w of workflows) {
      const f = fund(w.engagementId);
      f.workflowState = w.state;
      f.last = later(f.last, w.at);
    }
    for (const s of signoffs) {
      const f = fund(s.engagementId);
      f.signoffState = s.state;
      f.last = later(f.last, s.at);
    }
    for (const g of byStatus) {
      const f = fund(g.engagementId);
      if (g.status !== 'cleared') f.openPoints += g._count._all;
      if (g.status === 'responded') f.respondedPoints += g._count._all;
    }
    for (const g of overdue) fund(g.engagementId).overduePoints = g._count._all;
    for (const r of runs) {
      const f = fund(r.engagementId);
      f.analysed = true;
      f.last = later(f.last, r._max.at);
    }
    for (const m of messages) {
      const f = fund(m.engagementId);
      f.last = later(f.last, m._max.at);
    }
    return [...funds.values()].map(({ last, ...f }) => ({ ...f, lastActivityAt: last ? last.toISOString() : null }));
  }
}
