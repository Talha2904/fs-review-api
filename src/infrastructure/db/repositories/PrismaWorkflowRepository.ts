import type { WorkflowState } from '@fs-review/shared';

import type { Workflow, WorkflowEntry, WorkflowRepository } from '../../../application/ports/WorkflowRepository.js';
import type { Person } from '../../../domain/review/Document.js';
import type { Db } from '../prisma.js';

type Row = NonNullable<Awaited<ReturnType<Db['workflow']['findUnique']>>>;

const toDomain = (r: Row): Workflow => ({
  engagementId: r.engagementId,
  state: r.state as WorkflowState,
  by: (r.by as Person | null) ?? null,
  at: r.at ? r.at.toISOString() : null,
  reason: r.reason,
  history: (r.history as unknown as WorkflowEntry[]) ?? []
});

const plain = (v: unknown) => JSON.parse(JSON.stringify(v ?? null));

export class PrismaWorkflowRepository implements WorkflowRepository {
  constructor(private readonly db: Db) {}

  async get(engagementId: string): Promise<Workflow | null> {
    const r = await this.db.workflow.findUnique({ where: { engagementId } });
    return r ? toDomain(r) : null;
  }
  async listAll(): Promise<Workflow[]> {
    return (await this.db.workflow.findMany()).map(toDomain);
  }
  async save(w: Workflow): Promise<void> {
    const data = { state: w.state, by: plain(w.by), at: w.at ? new Date(w.at) : null, reason: w.reason, history: plain(w.history) };
    await this.db.workflow.upsert({
      where: { engagementId: w.engagementId },
      create: { engagementId: w.engagementId, ...data },
      update: data
    });
  }
}
