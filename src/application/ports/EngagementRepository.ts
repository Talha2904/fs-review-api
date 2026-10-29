import type { EngagementDocument } from '../../domain/review/Engagement.js';

export interface EngagementRecord {
  doc: EngagementDocument;
  createdBy: string | null;
  createdAt: string;
  updatedBy: string | null;
  updatedAt: string;
}

export interface EngagementRepository {
  list(): Promise<EngagementRecord[]>;
  findById(id: string): Promise<EngagementRecord | null>;
  /** Another engagement for the same entity, fund name and year end, ignoring `exceptId`. */
  findDuplicate(entityId: string | null, fundName: string, yearEnd: string, exceptId: string | null): Promise<EngagementRecord | null>;
  create(record: EngagementRecord): Promise<void>;
  update(record: EngagementRecord): Promise<void>;
}
