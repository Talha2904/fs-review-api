import type { EntityDocument } from '../../domain/review/Entity.js';

export interface EntityRecord {
  doc: EntityDocument;
  createdBy: string | null;
  createdAt: string;
  updatedBy: string | null;
  updatedAt: string;
}

export interface EntityRepository {
  list(): Promise<EntityRecord[]>;
  findById(id: string): Promise<EntityRecord | null>;
  findByNameKey(nameKey: string): Promise<EntityRecord | null>;
  create(record: EntityRecord): Promise<void>;
  update(record: EntityRecord): Promise<void>;
}
