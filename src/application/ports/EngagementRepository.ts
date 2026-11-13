import type { Person } from '../../domain/review/Document.js';
import type { EngagementDocument } from '../../domain/review/Engagement.js';

/** Set while a fund is deleted (a soft delete: every row of its review is kept so it can be restored). */
export interface EngagementDeletion {
  at: string;
  by: Person | null;
  reason: string | null;
}

export interface EngagementRecord {
  doc: EngagementDocument;
  createdBy: string | null;
  createdAt: string;
  updatedBy: string | null;
  updatedAt: string;
  /** only on records read with findIncludingDeleted or listDeleted */
  deleted?: EngagementDeletion | null;
}

/**
 * Funds. Every read except findIncludingDeleted and listDeleted leaves deleted funds out, so a deleted fund is
 * not found anywhere in the app (its id answers 404) until it is restored.
 */
export interface EngagementRepository {
  list(): Promise<EngagementRecord[]>;
  findById(id: string): Promise<EngagementRecord | null>;
  /** Another live engagement for the same entity, fund name and year end, ignoring `exceptId`. */
  findDuplicate(entityId: string | null, fundName: string, yearEnd: string, exceptId: string | null): Promise<EngagementRecord | null>;
  create(record: EngagementRecord): Promise<void>;
  /** Throws not found when the fund is no longer live (deleted at the same moment). */
  update(record: EngagementRecord): Promise<void>;
  /** Any fund with this id, deleted or not, with its deletion when it is deleted. */
  findIncludingDeleted(id: string): Promise<EngagementRecord | null>;
  /** The deleted funds, most recently deleted first. */
  listDeleted(): Promise<EngagementRecord[]>;
  /**
   * Marks a live fund deleted, atomically with the check that none of its analyses is queued or running (a conflict
   * if one is); false when it was not live (deleted or missing) at that moment.
   */
  markDeleted(id: string, deletion: EngagementDeletion): Promise<boolean>;
  /** Brings a deleted fund back; false when it was not deleted at that moment. */
  restore(id: string, updatedBy: string, at: string): Promise<boolean>;
}
