import type { Person } from '../../domain/review/Document.js';

/** An AI reading of one document's exact content: key = slot:sha256:model. The same file is never sent to AI twice. */
export interface DocumentReading {
  key: string;
  slot: string;
  sha256: string;
  model: string;
  reading: unknown;
  readBy: Person | null;
  readAt: string;
}

export interface ReadingRepository {
  get(key: string): Promise<DocumentReading | null>;
  /** Every reading of any of these fingerprints, for any model. */
  findBySha256(sha256s: string[]): Promise<DocumentReading[]>;
  save(reading: DocumentReading): Promise<void>;
}
