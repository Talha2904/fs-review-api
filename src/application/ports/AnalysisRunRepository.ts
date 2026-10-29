import type { Person } from '../../domain/review/Document.js';

export interface AnalysisRun {
  id: string;
  engagementId: string;
  /** the draft version analysed */
  version: number;
  /** the whole result the web app produced: documents read, figures, points, variance notes */
  result: Record<string, unknown>;
  analysedAt: string;
  settingsSig: string;
  /** slot -> document version id read by this run */
  documentVersions: Record<string, string>;
  by: Person | null;
  at: string;
}

export type AnalysisRunSummary = Omit<AnalysisRun, 'result'>;

export interface AnalysisRunRepository {
  latest(engagementId: string): Promise<AnalysisRun | null>;
  /** The latest run of every engagement that has one, without its result (the listing does not need it). */
  latestAll(): Promise<AnalysisRunSummary[]>;
  create(run: AnalysisRun): Promise<void>;
}
