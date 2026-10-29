import type { PointEvidence, PointMessage, ReviewPoint } from '../../domain/review/Point.js';

export interface PointRepository {
  listByEngagement(engagementId: string): Promise<ReviewPoint[]>;
  listAll(): Promise<ReviewPoint[]>;
  findById(id: string): Promise<ReviewPoint | null>;
  /** Throws a conflict when the reference was taken at the same moment. */
  create(point: ReviewPoint): Promise<void>;
  /** Saves the point only if nobody changed it since it was read (its updatedAt); otherwise a conflict. */
  update(point: ReviewPoint, expectedUpdatedAt: string): Promise<void>;
  /** Records that the point's thread moved on (a comment), changing nothing else. */
  touch(id: string, at: string): Promise<void>;
}

/** Insert only: a message is never edited or deleted. */
export interface PointMessageRepository {
  listByEngagement(engagementId: string): Promise<PointMessage[]>;
  listAll(): Promise<PointMessage[]>;
  create(message: PointMessage): Promise<void>;
}

export interface EvidenceRepository {
  findById(id: string): Promise<PointEvidence | null>;
  listByEngagement(engagementId: string): Promise<PointEvidence[]>;
  create(evidence: PointEvidence): Promise<void>;
}
