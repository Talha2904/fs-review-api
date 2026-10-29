import type { PermissionMatrix, Slot } from '@fs-review/shared';

import type { Actor } from '../../domain/identity/User.js';
import { currentVersions, viewOf, type DocumentVersion, type DocumentVersionView } from '../../domain/review/Document.js';
import type { PointMessage, ReviewPoint } from '../../domain/review/Point.js';
import { requirePermission } from '../identity/authorize.js';
import type { AnalysisJob, AnalysisJobRepository } from '../ports/AnalysisJobRepository.js';
import type { AnalysisRun, AnalysisRunRepository, AnalysisRunSummary } from '../ports/AnalysisRunRepository.js';
import type { ChecklistAnswerRepository, DisclosureChecklist } from '../ports/ChecklistAnswerRepository.js';
import type { DocumentRepository } from '../ports/DocumentRepository.js';
import type { PointMessageRepository, PointRepository } from '../ports/PointRepository.js';
import type { ReportRepository, ReviewReport, ReviewReportView } from '../ports/ReportRepository.js';
import { EMPTY_SIGNOFF, type Signoff, type SignoffRepository } from '../ports/SignoffRepository.js';
import { EMPTY_WORKFLOW, type Workflow, type WorkflowRepository } from '../ports/WorkflowRepository.js';

import type { ReviewAccess } from './access.js';

/** A fund's whole review, in the shape the web app's review store uses. */
export interface ReviewSnapshot {
  engagementId: string;
  versions: DocumentVersionView[];
  current: Partial<Record<Slot, DocumentVersionView>>;
  workflow: Workflow;
  signoff: Signoff;
  points: ReviewPoint[];
  messages: PointMessage[];
  checklist: DisclosureChecklist | null;
  reports: ReviewReportView[];
  /** The latest analysis. In the all-funds listing its `result` is left out to keep the payload small. */
  latestRun: AnalysisRun | (Omit<AnalysisRun, 'result'> & { result?: undefined }) | null;
  /** The latest analysis requested on the api: queued, running (with its step), done or failed. */
  analysisJob: AnalysisJob | null;
}

interface Parts {
  versions: DocumentVersion[];
  workflow: Workflow | null;
  signoff: Signoff | null;
  points: ReviewPoint[];
  messages: PointMessage[];
  checklist: DisclosureChecklist | null;
  reports: ReviewReport[];
  latestRun: AnalysisRun | AnalysisRunSummary | null;
  latestJob: AnalysisJob | null;
}

const reportView = (r: ReviewReport): ReviewReportView => {
  const { storageKey: _k, ...view } = r;
  return view;
};

export function buildSnapshot(engagementId: string, p: Parts, light = false): ReviewSnapshot {
  const sorted = [...p.versions].sort((a, b) => a.version - b.version || a.uploadedAt.localeCompare(b.uploadedAt));
  const current = Object.fromEntries(Object.entries(currentVersions(p.versions)).map(([slot, v]) => [slot, viewOf(v!)])) as Partial<
    Record<Slot, DocumentVersionView>
  >;
  let latestRun = p.latestRun as ReviewSnapshot['latestRun'];
  if (light && p.latestRun && 'result' in p.latestRun) {
    const { result: _r, ...rest } = p.latestRun;
    latestRun = rest;
  }
  return {
    engagementId,
    versions: sorted.map(viewOf),
    current,
    workflow: p.workflow ?? EMPTY_WORKFLOW(engagementId),
    signoff: p.signoff ?? EMPTY_SIGNOFF(engagementId),
    points: [...p.points].sort((a, b) => a.raisedAt.localeCompare(b.raisedAt)),
    messages: [...p.messages].sort((a, b) => a.at.localeCompare(b.at)),
    checklist: p.checklist,
    reports: [...p.reports].sort((a, b) => a.version - b.version).map(reportView),
    latestRun,
    analysisJob: p.latestJob
  };
}

export interface SnapshotSources {
  documents: DocumentRepository;
  workflows: WorkflowRepository;
  signoffs: SignoffRepository;
  points: PointRepository;
  messages: PointMessageRepository;
  checklists: ChecklistAnswerRepository;
  reports: ReportRepository;
  runs: AnalysisRunRepository;
  jobs: AnalysisJobRepository;
}

export class GetReviewSnapshot {
  constructor(
    private readonly access: ReviewAccess,
    private readonly s: SnapshotSources
  ) {}
  async execute(actor: Actor | null, matrix: PermissionMatrix, engagementId: string): Promise<ReviewSnapshot> {
    await this.access.reader(actor, matrix, engagementId);
    const [versions, workflow, signoff, points, messages, checklist, reports, latestRun, latestJob] = await Promise.all([
      this.s.documents.listByEngagement(engagementId),
      this.s.workflows.get(engagementId),
      this.s.signoffs.get(engagementId),
      this.s.points.listByEngagement(engagementId),
      this.s.messages.listByEngagement(engagementId),
      this.s.checklists.get(engagementId),
      this.s.reports.listByEngagement(engagementId),
      this.s.runs.latest(engagementId),
      this.s.jobs.latest(engagementId)
    ]);
    return buildSnapshot(engagementId, { versions, workflow, signoff, points, messages, checklist, reports, latestRun, latestJob });
  }
}

/** Every fund's review at once, for the portfolio, the bell and the umbrella documents of sister funds. */
export class ListReviewSnapshots {
  constructor(private readonly s: SnapshotSources) {}
  async execute(actor: Actor | null, matrix: PermissionMatrix): Promise<Record<string, ReviewSnapshot>> {
    requirePermission(actor, 'reviews.read', matrix);
    const [versions, workflows, signoffs, points, messages, checklists, reports, runs, jobs] = await Promise.all([
      this.s.documents.listAll(),
      this.s.workflows.listAll(),
      this.s.signoffs.listAll(),
      this.s.points.listAll(),
      this.s.messages.listAll(),
      this.s.checklists.listAll(),
      this.s.reports.listAll(),
      this.s.runs.latestAll(),
      this.s.jobs.latestAll()
    ]);
    const ids = new Set<string>([
      ...versions.map((v) => v.engagementId),
      ...workflows.map((w) => w.engagementId),
      ...signoffs.map((x) => x.engagementId),
      ...points.map((x) => x.engagementId),
      ...runs.map((x) => x.engagementId),
      ...jobs.map((x) => x.engagementId)
    ]);
    // grouped once by fund, so the listing grows with the number of rows, not rows times funds
    const many = <T extends { engagementId: string }>(rows: T[]) => {
      const m = new Map<string, T[]>();
      for (const r of rows) (m.get(r.engagementId) ?? m.set(r.engagementId, []).get(r.engagementId)!).push(r);
      return (id: string) => m.get(id) ?? [];
    };
    const one = <T extends { engagementId: string }>(rows: T[]) => {
      const m = new Map(rows.map((r) => [r.engagementId, r] as const));
      return (id: string) => m.get(id) ?? null;
    };
    const [vOf, pOf, mOf, rOf] = [many(versions), many(points), many(messages), many(reports)];
    const [wOf, sOf, cOf, runOf, jobOf] = [one(workflows), one(signoffs), one(checklists), one(runs), one(jobs)];
    const out: Record<string, ReviewSnapshot> = {};
    for (const id of ids)
      out[id] = buildSnapshot(
        id,
        {
          versions: vOf(id),
          workflow: wOf(id),
          signoff: sOf(id),
          points: pOf(id),
          messages: mOf(id),
          checklist: cOf(id),
          reports: rOf(id),
          latestRun: runOf(id),
          latestJob: jobOf(id)
        },
        true
      );
    return out;
  }
}
