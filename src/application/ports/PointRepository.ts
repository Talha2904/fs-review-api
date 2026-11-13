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
  /** Every live fund's copy of these shared points (a deleted fund's copy is left out). */
  listBySharedGroups(groupIds: string[]): Promise<ReviewPoint[]>;
  /**
   * Sharing changes several funds' points at once, so it is saved all or nothing: the new copies, the points it
   * links (each only if unchanged since it was read) and their thread notes. A clash saves nothing (a conflict).
   */
  saveShared(change: SharedChange): Promise<void>;
}

export interface SharedChange {
  create: ReviewPoint[];
  update: { point: ReviewPoint; expectedUpdatedAt: string }[];
  messages: PointMessage[];
}

/** Insert only: a message is never edited or deleted. */
export interface PointMessageRepository {
  listByEngagement(engagementId: string): Promise<PointMessage[]>;
  listAll(): Promise<PointMessage[]>;
  /** The threads of these points (the other funds' copies of a shared point). */
  listByPoints(pointIds: string[]): Promise<PointMessage[]>;
  create(message: PointMessage): Promise<void>;
}

export interface EvidenceRepository {
  findById(id: string): Promise<PointEvidence | null>;
  listByEngagement(engagementId: string): Promise<PointEvidence[]>;
  create(evidence: PointEvidence): Promise<void>;
}
