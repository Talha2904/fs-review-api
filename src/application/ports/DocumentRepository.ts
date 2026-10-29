import type { DocumentVersion, Person } from '../../domain/review/Document.js';

/** The fields a person changes on a version after it is attached. */
export type DocumentChanges = Partial<Pick<DocumentVersion, 'validation' | 'confirmation' | 'readWith' | 'readWithBy' | 'readWithAt'>>;

export interface DocumentRepository {
  /** Every version of every slot for the engagement, oldest first. */
  listByEngagement(engagementId: string): Promise<DocumentVersion[]>;
  /** Every version for every engagement, for the cross-fund view. */
  listAll(): Promise<DocumentVersion[]>;
  findById(id: string): Promise<DocumentVersion | null>;
  /** Throws a conflict when the slot's version number was taken at the same moment. */
  create(v: DocumentVersion): Promise<void>;
  /** Changes only these fields, and only while the version is not removed; false when it was removed meanwhile. */
  patch(id: string, changes: DocumentChanges): Promise<boolean>;
  /** Marks the version removed unless it already is; false when someone removed it first. */
  markRemoved(id: string, by: Person, at: string): Promise<boolean>;
}
