import type { Person } from '../../domain/review/Document.js';

export type ConsolidatedStatus = 'queued' | 'running' | 'done' | 'failed';

/**
 * One Consolidated Review of a group: every fund of the entities that share a Client name and year end. It
 * runs in the background like an analysis; when done it holds its result and the analysis runs it read.
 */
export interface ConsolidatedReviewRecord {
  id: string;
  groupKey: string;
  groupName: string;
  yearEnd: string;
  status: ConsolidatedStatus;
  step: number;
  total: number;
  error: string | null;
  /** engagementId -> the analysis run read (null when the fund was not analysed) */
  runIds: Record<string, string | null>;
  /** the review (ConsolidationResult plus how AI was used); null until done */
  result: Record<string, unknown> | null;
  requestedBy: Person;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export const isActiveConsolidation = (r: ConsolidatedReviewRecord | null | undefined): boolean =>
  !!r && (r.status === 'queued' || r.status === 'running');

export interface ConsolidatedReviewRepository {
  /** Saves the review only if the group has none queued or running, atomically; false when one exists. */
  createIfIdle(r: ConsolidatedReviewRecord): Promise<boolean>;
  update(r: ConsolidatedReviewRecord): Promise<void>;
  /** Saves the review only while it is still running (not given up as stuck meanwhile); false when it was not. */
  updateWhileRunning(r: ConsolidatedReviewRecord): Promise<boolean>;
  findById(id: string): Promise<ConsolidatedReviewRecord | null>;
  /** The most recent review of a group, whatever its status. */
  latest(groupKey: string, yearEnd: string): Promise<ConsolidatedReviewRecord | null>;
  /** The most recent finished review of a group. */
  latestDone(groupKey: string, yearEnd: string): Promise<ConsolidatedReviewRecord | null>;
  /** The most recent review of every group that has one (the group list). */
  latestAll(): Promise<ConsolidatedReviewRecord[]>;
  /** Reviews in one of these statuses, oldest first (used after a restart). */
  listByStatus(statuses: ConsolidatedStatus[]): Promise<ConsolidatedReviewRecord[]>;
}
