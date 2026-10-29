import type {
  AnalysisJob,
  AnalysisJobRepository,
  AnalysisJobStatus,
  AnalysisMode
} from '../../../application/ports/AnalysisJobRepository.js';
import type { Person } from '../../../domain/review/Document.js';
import type { Db } from '../prisma.js';

type Row = NonNullable<Awaited<ReturnType<Db['analysisJob']['findFirst']>>>;

const MAX_ATTEMPTS = 8;

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);
const date = (s: string | null): Date | null => (s ? new Date(s) : null);

const toDomain = (r: Row): AnalysisJob => ({
  id: r.id,
  engagementId: r.engagementId,
  mode: r.mode as AnalysisMode,
  status: r.status as AnalysisJobStatus,
  step: r.step,
  total: r.total,
  error: r.error,
  runId: r.runId,
  requestedBy: r.requestedBy as unknown as Person,
  createdAt: r.createdAt.toISOString(),
  startedAt: iso(r.startedAt),
  finishedAt: iso(r.finishedAt)
});

const data = (j: AnalysisJob) => ({
  engagementId: j.engagementId,
  mode: j.mode,
  status: j.status,
  step: j.step,
  total: j.total,
  error: j.error,
  runId: j.runId,
  requestedBy: { id: j.requestedBy.id, name: j.requestedBy.name, role: j.requestedBy.role },
  createdAt: new Date(j.createdAt),
  startedAt: date(j.startedAt),
  finishedAt: date(j.finishedAt)
});

export class PrismaAnalysisJobRepository implements AnalysisJobRepository {
  constructor(private readonly db: Db) {}

  /**
   * Serializable, so two starts at the same moment cannot both find the fund idle (portable to MySQL). The database
   * can also report a conflict between starts for different funds (Postgres locks ranges of the index it reads), so a
   * conflict is retried: a second start for the same fund then finds the first one queued and is refused.
   */
  async createIfIdle(job: AnalysisJob): Promise<boolean> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.db.$transaction(
          async (tx) => {
            const busy = await tx.analysisJob.count({ where: { engagementId: job.engagementId, status: { in: ['queued', 'running'] } } });
            if (busy) return false;
            await tx.analysisJob.create({ data: { id: job.id, ...data(job) } });
            return true;
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

  async update(job: AnalysisJob): Promise<void> {
    await this.db.analysisJob.update({ where: { id: job.id }, data: data(job) });
  }

  async findById(id: string): Promise<AnalysisJob | null> {
    const r = await this.db.analysisJob.findUnique({ where: { id } });
    return r ? toDomain(r) : null;
  }

  async latest(engagementId: string): Promise<AnalysisJob | null> {
    const r = await this.db.analysisJob.findFirst({ where: { engagementId }, orderBy: { createdAt: 'desc' } });
    return r ? toDomain(r) : null;
  }

  /** Portable: one query ordered by engagement then time, keeping the first row per engagement. */
  async latestAll(): Promise<AnalysisJob[]> {
    const rows = await this.db.analysisJob.findMany({ orderBy: [{ engagementId: 'asc' }, { createdAt: 'desc' }] });
    const seen = new Set<string>();
    return rows.filter((r) => !seen.has(r.engagementId) && seen.add(r.engagementId)).map(toDomain);
  }

  async listByStatus(statuses: AnalysisJobStatus[]): Promise<AnalysisJob[]> {
    const rows = await this.db.analysisJob.findMany({ where: { status: { in: statuses } }, orderBy: { createdAt: 'asc' } });
    return rows.map(toDomain);
  }
}
