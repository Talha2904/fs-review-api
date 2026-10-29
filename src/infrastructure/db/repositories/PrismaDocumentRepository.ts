import { Prisma } from '@prisma/client';

import type { Slot } from '@fs-review/shared';

import type { DocumentChanges, DocumentRepository } from '../../../application/ports/DocumentRepository.js';
import { conflict } from '../../../domain/errors.js';
import type { Confirmation, DocumentVersion, Person, Validation } from '../../../domain/review/Document.js';
import type { Db } from '../prisma.js';

type Row = NonNullable<Awaited<ReturnType<Db['documentVersion']['findUnique']>>>;

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);
const json = <T>(v: unknown): T | null => (v === null || v === undefined ? null : (v as T));

const toDomain = (r: Row): DocumentVersion => ({
  id: r.id,
  engagementId: r.engagementId,
  slot: r.slot as Slot,
  version: r.version,
  fileName: r.fileName,
  size: r.size,
  sha256: r.sha256,
  sample: r.sample,
  storageKey: r.storageKey,
  uploadedBy: json<Person>(r.uploadedBy),
  uploadedAt: r.uploadedAt.toISOString(),
  removedAt: iso(r.removedAt),
  removedBy: json<Person>(r.removedBy),
  validation: json<Validation>(r.validation),
  confirmation: json<Confirmation>(r.confirmation),
  readWith: r.readWith,
  readWithBy: json<Person>(r.readWithBy),
  readWithAt: iso(r.readWithAt),
  sameAs: r.sameAs
});

const plain = (v: unknown) => (v === null || v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

const toRow = (v: DocumentVersion) => ({
  engagementId: v.engagementId,
  slot: v.slot,
  version: v.version,
  fileName: v.fileName,
  size: v.size,
  sha256: v.sha256,
  sample: v.sample,
  storageKey: v.storageKey,
  uploadedBy: plain(v.uploadedBy),
  uploadedAt: new Date(v.uploadedAt),
  removedAt: v.removedAt ? new Date(v.removedAt) : null,
  removedBy: plain(v.removedBy),
  validation: plain(v.validation),
  confirmation: plain(v.confirmation),
  readWith: v.readWith,
  readWithBy: plain(v.readWithBy),
  readWithAt: v.readWithAt ? new Date(v.readWithAt) : null,
  sameAs: v.sameAs
});

export class PrismaDocumentRepository implements DocumentRepository {
  constructor(private readonly db: Db) {}

  async listByEngagement(engagementId: string): Promise<DocumentVersion[]> {
    return (await this.db.documentVersion.findMany({ where: { engagementId }, orderBy: [{ slot: 'asc' }, { version: 'asc' }] })).map(
      toDomain
    );
  }
  async listAll(): Promise<DocumentVersion[]> {
    return (await this.db.documentVersion.findMany({ orderBy: [{ engagementId: 'asc' }, { slot: 'asc' }, { version: 'asc' }] })).map(
      toDomain
    );
  }
  async findById(id: string): Promise<DocumentVersion | null> {
    const r = await this.db.documentVersion.findUnique({ where: { id } });
    return r ? toDomain(r) : null;
  }
  async create(v: DocumentVersion): Promise<void> {
    try {
      await this.db.documentVersion.create({ data: { id: v.id, ...toRow(v) } });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002')
        throw conflict('Another version of this document was attached at the same moment. Try again.');
      throw e;
    }
  }
  async patch(id: string, c: DocumentChanges): Promise<boolean> {
    const data = {
      ...('validation' in c ? { validation: plain(c.validation) ?? Prisma.DbNull } : {}),
      ...('confirmation' in c ? { confirmation: plain(c.confirmation) ?? Prisma.DbNull } : {}),
      ...('readWith' in c ? { readWith: c.readWith ?? null } : {}),
      ...('readWithBy' in c ? { readWithBy: plain(c.readWithBy) ?? Prisma.DbNull } : {}),
      ...('readWithAt' in c ? { readWithAt: c.readWithAt ? new Date(c.readWithAt) : null } : {})
    };
    const r = await this.db.documentVersion.updateMany({ where: { id, removedAt: null }, data });
    return r.count === 1;
  }
  async markRemoved(id: string, by: Person, at: string): Promise<boolean> {
    const r = await this.db.documentVersion.updateMany({
      where: { id, removedAt: null },
      data: { removedAt: new Date(at), removedBy: plain(by) }
    });
    return r.count === 1;
  }
}
