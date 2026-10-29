import type { Person } from '../../domain/review/Document.js';

export type AnalysisMode = 'full' | 'nextDraft';
export type AnalysisJobStatus = 'queued' | 'running' | 'done' | 'failed';

/** An analysis requested on the api. It runs in the background; the screens follow its progress live. */
export interface AnalysisJob {
  id: string;
  engagementId: string;
  mode: AnalysisMode;
  status: AnalysisJobStatus;
  /** steps finished, of `total` (the progress list the screens show) */
  step: number;
  total: number;
  /** a plain-language reason when the job failed */
  error: string | null;
  /** the analysis run it produced */
  runId: string | null;
  requestedBy: Person;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export const isActiveJob = (j: AnalysisJob | null | undefined): boolean => !!j && (j.status === 'queued' || j.status === 'running');

export interface AnalysisJobRepository {
  /** Saves the job only if the engagement has no queued or running job, atomically; false when one exists. */
  createIfIdle(job: AnalysisJob): Promise<boolean>;
  update(job: AnalysisJob): Promise<void>;
  findById(id: string): Promise<AnalysisJob | null>;
  /** The most recent job of an engagement, whatever its status. */
  latest(engagementId: string): Promise<AnalysisJob | null>;
  /** The most recent job of every engagement that has one. */
  latestAll(): Promise<AnalysisJob[]>;
  /** Jobs in one of these statuses, oldest first (used after a restart). */
  listByStatus(statuses: AnalysisJobStatus[]): Promise<AnalysisJob[]>;
}
