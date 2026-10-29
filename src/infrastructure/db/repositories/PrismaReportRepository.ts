import type { ReportRepository, ReviewReport } from '../../../application/ports/ReportRepository.js';
import type { Person } from '../../../domain/review/Document.js';
import type { Db } from '../prisma.js';

type Row = NonNullable<Awaited<ReturnType<Db['reviewReport']['findUnique']>>>;

const toDomain = (r: Row): ReviewReport => ({
  id: r.id,
  engagementId: r.engagementId,
  version: r.version,
  sha256: r.sha256,
  size: r.size,
  storageKey: r.storageKey,
  by: (r.by as Person | null) ?? null,
  at: r.at.toISOString(),
  signedBy: (r.signedBy as Person | null) ?? null,
  signedAt: r.signedAt ? r.signedAt.toISOString() : null
});

const plain = (v: unknown) => JSON.parse(JSON.stringify(v ?? null));

export class PrismaReportRepository implements ReportRepository {
  constructor(private readonly db: Db) {}

  async listByEngagement(engagementId: string): Promise<ReviewReport[]> {
    return (await this.db.reviewReport.findMany({ where: { engagementId }, orderBy: { version: 'asc' } })).map(toDomain);
  }
  async listAll(): Promise<ReviewReport[]> {
    return (await this.db.reviewReport.findMany({ orderBy: [{ engagementId: 'asc' }, { version: 'asc' }] })).map(toDomain);
  }
  async findById(id: string): Promise<ReviewReport | null> {
    const r = await this.db.reviewReport.findUnique({ where: { id } });
    return r ? toDomain(r) : null;
  }
  async create(rep: ReviewReport): Promise<void> {
    await this.db.reviewReport.create({
      data: {
        id: rep.id,
        engagementId: rep.engagementId,
        version: rep.version,
        sha256: rep.sha256,
        size: rep.size,
        storageKey: rep.storageKey,
        by: plain(rep.by),
        at: new Date(rep.at),
        signedBy: plain(rep.signedBy),
        signedAt: rep.signedAt ? new Date(rep.signedAt) : null
      }
    });
  }
}
