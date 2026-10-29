import type { PointStatus } from '@fs-review/shared';

import type { EvidenceRepository, PointMessageRepository, PointRepository } from '../../../application/ports/PointRepository.js';
import { conflict } from '../../../domain/errors.js';
import type { Person } from '../../../domain/review/Document.js';
import type {
  Attachment,
  MessageKind,
  PointContent,
  PointEvidence,
  PointMessage,
  PointSource,
  PointType,
  ReviewPoint
} from '../../../domain/review/Point.js';
import type { Db } from '../prisma.js';

type PointRow = NonNullable<Awaited<ReturnType<Db['reviewPoint']['findUnique']>>>;
type MessageRow = NonNullable<Awaited<ReturnType<Db['pointMessage']['findFirst']>>>;
type EvidenceRow = NonNullable<Awaited<ReturnType<Db['pointEvidence']['findUnique']>>>;

const plain = (v: unknown) => JSON.parse(JSON.stringify(v ?? null));
const person = (v: unknown): Person | null => (v as Person | null) ?? null;

const pointToDomain = (r: PointRow): ReviewPoint => ({
  id: r.id,
  engagementId: r.engagementId,
  ref: r.ref,
  source: r.source as PointSource,
  content: r.content as PointContent,
  status: r.status as PointStatus,
  type: r.type as PointType,
  dueDate: r.dueDate,
  assignedTo: person(r.assignedTo),
  raisedBy: person(r.raisedBy),
  raisedAt: r.raisedAt.toISOString(),
  clearedBy: person(r.clearedBy),
  clearedAt: r.clearedAt ? r.clearedAt.toISOString() : null,
  updatedAt: r.updatedAt.toISOString()
});

const pointToRow = (p: ReviewPoint) => ({
  engagementId: p.engagementId,
  ref: p.ref,
  title: String(p.content?.title ?? ''),
  source: p.source,
  content: plain(p.content),
  status: p.status,
  type: p.type,
  dueDate: p.dueDate,
  assignedTo: plain(p.assignedTo),
  raisedBy: plain(p.raisedBy),
  raisedAt: new Date(p.raisedAt),
  clearedBy: plain(p.clearedBy),
  clearedAt: p.clearedAt ? new Date(p.clearedAt) : null,
  updatedAt: new Date(p.updatedAt)
});

export class PrismaPointRepository implements PointRepository {
  constructor(private readonly db: Db) {}
  async listByEngagement(engagementId: string): Promise<ReviewPoint[]> {
    return (await this.db.reviewPoint.findMany({ where: { engagementId }, orderBy: { raisedAt: 'asc' } })).map(pointToDomain);
  }
  async listAll(): Promise<ReviewPoint[]> {
    return (await this.db.reviewPoint.findMany({ orderBy: { raisedAt: 'asc' } })).map(pointToDomain);
  }
  async findById(id: string): Promise<ReviewPoint | null> {
    const r = await this.db.reviewPoint.findUnique({ where: { id } });
    return r ? pointToDomain(r) : null;
  }
  async create(p: ReviewPoint): Promise<void> {
    try {
      await this.db.reviewPoint.create({ data: { id: p.id, ...pointToRow(p) } });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') throw conflict(`${p.ref} was raised by someone else at the same moment. Try again.`);
      throw e;
    }
  }
  async update(p: ReviewPoint, expectedUpdatedAt: string): Promise<void> {
    const r = await this.db.reviewPoint.updateMany({ where: { id: p.id, updatedAt: new Date(expectedUpdatedAt) }, data: pointToRow(p) });
    if (r.count !== 1) throw conflict(`${p.ref} was changed by someone else at the same moment. Reload it and try again.`);
  }
  async touch(id: string, at: string): Promise<void> {
    await this.db.reviewPoint.update({ where: { id }, data: { updatedAt: new Date(at) } });
  }
}

const messageToDomain = (r: MessageRow): PointMessage => ({
  id: r.id,
  pointId: r.pointId,
  engagementId: r.engagementId,
  kind: r.kind as MessageKind,
  author: person(r.author),
  at: r.at.toISOString(),
  text: r.text,
  attachments: (r.attachments as Attachment[]) ?? []
});

/** Insert only: this class has no update or delete method. */
export class PrismaPointMessageRepository implements PointMessageRepository {
  constructor(private readonly db: Db) {}
  async listByEngagement(engagementId: string): Promise<PointMessage[]> {
    return (await this.db.pointMessage.findMany({ where: { engagementId }, orderBy: { at: 'asc' } })).map(messageToDomain);
  }
  async listAll(): Promise<PointMessage[]> {
    return (await this.db.pointMessage.findMany({ orderBy: { at: 'asc' } })).map(messageToDomain);
  }
  async create(m: PointMessage): Promise<void> {
    await this.db.pointMessage.create({
      data: {
        id: m.id,
        pointId: m.pointId,
        engagementId: m.engagementId,
        kind: m.kind,
        author: plain(m.author),
        at: new Date(m.at),
        text: m.text,
        attachments: plain(m.attachments)
      }
    });
  }
}

const evidenceToDomain = (r: EvidenceRow): PointEvidence => ({
  id: r.id,
  engagementId: r.engagementId,
  pointId: r.pointId,
  fileName: r.fileName,
  size: r.size,
  sha256: r.sha256,
  storageKey: r.storageKey,
  by: person(r.by),
  at: r.at.toISOString()
});

export class PrismaEvidenceRepository implements EvidenceRepository {
  constructor(private readonly db: Db) {}
  async findById(id: string): Promise<PointEvidence | null> {
    const r = await this.db.pointEvidence.findUnique({ where: { id } });
    return r ? evidenceToDomain(r) : null;
  }
  async listByEngagement(engagementId: string): Promise<PointEvidence[]> {
    return (await this.db.pointEvidence.findMany({ where: { engagementId }, orderBy: { at: 'asc' } })).map(evidenceToDomain);
  }
  async create(e: PointEvidence): Promise<void> {
    await this.db.pointEvidence.create({
      data: {
        id: e.id,
        engagementId: e.engagementId,
        pointId: e.pointId,
        fileName: e.fileName,
        size: e.size,
        sha256: e.sha256,
        storageKey: e.storageKey,
        by: plain(e.by),
        at: new Date(e.at)
      }
    });
  }
}
