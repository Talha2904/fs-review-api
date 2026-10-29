import type { Person } from '../../domain/review/Document.js';

/** The permanent review report made at each final sign-off; earlier versions are kept. */
export interface ReviewReport {
  id: string;
  engagementId: string;
  version: number;
  sha256: string;
  size: number;
  storageKey: string;
  by: Person | null;
  at: string;
  signedBy: Person | null;
  signedAt: string | null;
}

export type ReviewReportView = Omit<ReviewReport, 'storageKey'>;

export interface ReportRepository {
  listByEngagement(engagementId: string): Promise<ReviewReport[]>;
  listAll(): Promise<ReviewReport[]>;
  findById(id: string): Promise<ReviewReport | null>;
  create(report: ReviewReport): Promise<void>;
}
