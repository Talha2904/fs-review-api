import type { AnalysisRun, AnalysisRunRepository, AnalysisRunSummary } from '../../../application/ports/AnalysisRunRepository.js';
import type { Person } from '../../../domain/review/Document.js';
import type { Db } from '../prisma.js';

type Row = NonNullable<Awaited<ReturnType<Db['analysisRun']['findFirst']>>>;

const toDomain = (r: Row): AnalysisRun => ({
  id: r.id,
  engagementId: r.engagementId,
  version: r.draftVersion,
  result: r.result as Record<string, unknown>,
  analysedAt: r.analysedAt.toISOString(),
  settingsSig: r.settingsSig,
  documentVersions: r.documentVersions as Record<string, string>,
  by: (r.by as Person | null) ?? null,
  at: r.at.toISOString()
});

const plain = (v: unknown) => JSON.parse(JSON.stringify(v ?? null));

export class PrismaAnalysisRunRepository implements AnalysisRunRepository {
  constructor(private readonly db: Db) {}

  async latest(engagementId: string): Promise<AnalysisRun | null> {
    const r = await this.db.analysisRun.findFirst({ where: { engagementId }, orderBy: { at: 'desc' } });
    return r ? toDomain(r) : null;
  }

  /** Portable: one query ordered by engagement then time, keep the first row per engagement. */
  async latestAll(): Promise<AnalysisRunSummary[]> {
    const rows = await this.db.analysisRun.findMany({
      select: {
        id: true,
        engagementId: true,
        draftVersion: true,
        analysedAt: true,
        settingsSig: true,
        documentVersions: true,
        by: true,
        at: true
      },
      orderBy: [{ engagementId: 'asc' }, { at: 'desc' }]
    });
    const seen = new Set<string>();
    const out: AnalysisRunSummary[] = [];
    for (const r of rows) {
      if (seen.has(r.engagementId)) continue;
      seen.add(r.engagementId);
      const { result: _r, ...summary } = toDomain({ ...r, result: null });
      out.push(summary);
    }
    return out;
  }

  async create(run: AnalysisRun): Promise<void> {
    await this.db.analysisRun.create({
      data: {
        id: run.id,
        engagementId: run.engagementId,
        draftVersion: run.version,
        result: plain(run.result),
        analysedAt: new Date(run.analysedAt),
        settingsSig: run.settingsSig,
        documentVersions: plain(run.documentVersions),
        by: plain(run.by),
        at: new Date(run.at)
      }
    });
  }
}
