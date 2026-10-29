import type { ReviewLike } from '@fs-review/shared';

import type { AnalysisRunRepository } from '../../../application/ports/AnalysisRunRepository.js';
import type { BellReadModel } from '../../../application/ports/BellReadModel.js';
import type { SignoffRepository } from '../../../application/ports/SignoffRepository.js';
import type { WorkflowRepository } from '../../../application/ports/WorkflowRepository.js';
import { currentVersions, type DocumentVersion } from '../../../domain/review/Document.js';
import type { Db } from '../prisma.js';

type Who = { id: string; name: string; role?: string } | null;
const who = (v: unknown): Who => (v as Who) ?? null;

/** The bell's reads with column selects: six queries at once, whatever the number of funds. */
export class PrismaBellReadModel implements BellReadModel {
  constructor(
    private readonly db: Db,
    private readonly s: { workflows: WorkflowRepository; signoffs: SignoffRepository; runs: AnalysisRunRepository }
  ) {}

  async reviews(userId: string, messagesSince: string): Promise<Record<string, ReviewLike>> {
    const [versions, workflows, signoffs, points, recent, runs] = await Promise.all([
      this.db.documentVersion.findMany({
        select: {
          id: true,
          engagementId: true,
          slot: true,
          version: true,
          fileName: true,
          sample: true,
          sha256: true,
          uploadedAt: true,
          removedAt: true,
          validation: true,
          confirmation: true,
          readWith: true
        }
      }),
      this.s.workflows.listAll(),
      this.s.signoffs.listAll(),
      this.db.reviewPoint.findMany({
        select: {
          id: true,
          engagementId: true,
          ref: true,
          title: true,
          source: true,
          status: true,
          dueDate: true,
          assignedTo: true,
          raisedBy: true,
          raisedAt: true,
          updatedAt: true
        },
        orderBy: { raisedAt: 'asc' }
      }),
      // the window's messages in one query alongside the others; filtered to this person's points below
      this.db.pointMessage.findMany({
        where: { at: { gte: new Date(messagesSince) } },
        select: { id: true, pointId: true, engagementId: true, kind: true, author: true, at: true, text: true },
        orderBy: { at: 'asc' }
      }),
      this.s.runs.latestAll()
    ]);
    // only the threads of this person's points can become their updates
    const theirs = new Set(points.filter((p) => who(p.raisedBy)?.id === userId || who(p.assignedTo)?.id === userId).map((p) => p.id));
    const messages = recent.filter((m) => theirs.has(m.pointId));

    const out: Record<string, ReviewLike> = {};
    const of = (id: string): ReviewLike =>
      (out[id] ??= {
        versions: [],
        current: {},
        workflow: { state: 'preparing', history: [] },
        signoff: { state: 'none', history: [] },
        points: [],
        messages: [],
        latestRun: null
      });
    const versionsOf = new Map<string, typeof versions>();
    for (const v of versions) (versionsOf.get(v.engagementId) ?? versionsOf.set(v.engagementId, []).get(v.engagementId)!).push(v);
    for (const [id, rows] of versionsOf) {
      const view = rows.map((v) => ({
        id: v.id,
        slot: v.slot,
        fileName: v.fileName,
        version: v.version,
        sample: v.sample,
        sha256: v.sha256,
        uploadedAt: v.uploadedAt.toISOString(),
        removedAt: v.removedAt ? v.removedAt.toISOString() : null,
        validation: (v.validation ?? null) as { ocrLow?: number; localReadable?: boolean } | null,
        confirmation: v.confirmation,
        readWith: v.readWith
      }));
      const s = of(id);
      s.versions = view;
      s.current = currentVersions(view as unknown as DocumentVersion[]) as unknown as ReviewLike['current'];
    }
    for (const w of workflows) of(w.engagementId).workflow = w;
    for (const x of signoffs) of(x.engagementId).signoff = x;
    for (const p of points)
      of(p.engagementId).points.push({
        id: p.id,
        ref: p.ref,
        status: p.status,
        source: p.source,
        content: { title: p.title },
        dueDate: p.dueDate,
        assignedTo: who(p.assignedTo),
        raisedBy: who(p.raisedBy),
        raisedAt: p.raisedAt.toISOString(),
        updatedAt: p.updatedAt.toISOString()
      });
    for (const m of messages)
      of(m.engagementId).messages.push({
        id: m.id,
        pointId: m.pointId,
        kind: m.kind,
        author: who(m.author),
        at: m.at.toISOString(),
        text: m.text
      });
    for (const r of runs) of(r.engagementId).latestRun = r;
    return out;
  }
}
