// Shared review points against a real Postgres (DATABASE_URL_TEST): the link is stored and read back, kept by an
// ordinary update, found across funds, and the other copies' threads are read by point. Rows are removed afterwards.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ReviewPoint } from '../../src/domain/review/Point.js';
import { createDb, type Db } from '../../src/infrastructure/db/prisma.js';
import { PrismaPointMessageRepository, PrismaPointRepository } from '../../src/infrastructure/db/repositories/PrismaPointRepositories.js';

const url = process.env.DATABASE_URL_TEST;
const ENGS = ['eng-shared-a', 'eng-shared-b'];
const at = '2026-11-01T10:00:00.000Z';

const point = (id: string, engagementId: string, ref: string, sharedGroupId: string | null): ReviewPoint => ({
  id,
  engagementId,
  ref,
  source: 'manual',
  content: { title: 'Matter' },
  status: 'open',
  type: 'change',
  dueDate: null,
  assignedTo: null,
  raisedBy: null,
  raisedAt: at,
  clearedBy: null,
  clearedAt: null,
  updatedAt: at,
  sharedGroupId
});

describe.skipIf(!url)('Shared review points (Postgres)', () => {
  let db: Db;
  let points: PrismaPointRepository;
  let messages: PrismaPointMessageRepository;
  const wipe = async () => {
    await db.pointMessage.deleteMany({ where: { engagementId: { in: ENGS } } });
    await db.reviewPoint.deleteMany({ where: { engagementId: { in: ENGS } } });
    await db.engagement.deleteMany({ where: { id: { in: ENGS } } });
  };
  beforeAll(async () => {
    db = createDb(url!);
    points = new PrismaPointRepository(db);
    messages = new PrismaPointMessageRepository(db);
    await wipe();
    for (const id of ENGS)
      await db.engagement.create({
        data: { id, fundName: id, yearEnd: '2026-12-31', currency: 'GBP', data: {}, createdAt: new Date(at), updatedAt: new Date(at) }
      });
  });
  afterAll(async () => {
    await wipe();
    await db.$disconnect();
  });

  it('stores the link, keeps it through an update, and finds every copy and its thread', async () => {
    await points.create(point('sp-a', ENGS[0]!, 'RP-01', 'grp-1'));
    await points.create(point('sp-b', ENGS[1]!, 'SP-1', 'grp-1'));
    await points.create(point('sp-c', ENGS[1]!, 'RP-01', null));
    const a = (await points.findById('sp-a'))!;
    expect(a.sharedGroupId).toBe('grp-1');
    expect((await points.findById('sp-c'))!.sharedGroupId).toBeNull();
    await points.update({ ...a, content: { title: 'Matter, re-tested' }, updatedAt: '2026-11-01T11:00:00.000Z' }, a.updatedAt);
    expect((await points.findById('sp-a'))!.sharedGroupId).toBe('grp-1');
    expect((await points.listBySharedGroups(['grp-1'])).map((p) => p.id).sort()).toEqual(['sp-a', 'sp-b']);
    expect(await points.listBySharedGroups([])).toEqual([]);
    await messages.create({
      id: 'sm-1',
      pointId: 'sp-b',
      engagementId: ENGS[1]!,
      kind: 'comment',
      author: null,
      at,
      text: 'Hi',
      attachments: []
    });
    expect((await messages.listByPoints(['sp-b'])).map((m) => m.text)).toEqual(['Hi']);
    expect(await messages.listByPoints([])).toEqual([]);
  });

  it('saves a share all or nothing, and the database allows one copy per fund', async () => {
    const before = (await points.findById('sp-c'))!;
    // a point changed meanwhile: the copy and the notes are not saved either
    await expect(
      points.saveShared({
        create: [point('sp-d', ENGS[0]!, 'SP-1', 'grp-2')],
        update: [{ point: { ...before, sharedGroupId: 'grp-2' }, expectedUpdatedAt: '2020-01-01T00:00:00.000Z' }],
        messages: [{ id: 'sm-2', pointId: 'sp-c', engagementId: ENGS[1]!, kind: 'note', author: null, at, text: 'x', attachments: [] }]
      })
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await points.findById('sp-d')).toBeNull();
    expect((await points.findById('sp-c'))!.sharedGroupId).toBeNull();
    expect(await messages.listByPoints(['sp-c'])).toEqual([]);
    // a second copy of grp-1 in a fund that has one already
    await expect(points.saveShared({ create: [point('sp-e', ENGS[1]!, 'SP-2', 'grp-1')], update: [], messages: [] })).rejects.toMatchObject(
      { code: 'CONFLICT' }
    );
    expect(await points.findById('sp-e')).toBeNull();
  });
});
