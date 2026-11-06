// Consolidated Reviews against a real Postgres (DATABASE_URL_TEST): one running review per group, a result
// stored and read back whole, and the group list without results. Rows use test-only group keys and are removed.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ConsolidatedReviewRecord } from '../../src/application/ports/ConsolidatedReviewRepository.js';
import { createDb, type Db } from '../../src/infrastructure/db/prisma.js';
import { PrismaConsolidatedReviewRepository } from '../../src/infrastructure/db/repositories/PrismaConsolidatedReviewRepository.js';

const url = process.env.DATABASE_URL_TEST;
const KEYS = ['it-consolidated-a', 'it-consolidated-b'];

const rec = (id: string, groupKey: string, createdAt: string): ConsolidatedReviewRecord => ({
  id,
  groupKey,
  groupName: 'Test group',
  yearEnd: '2026-12-31',
  status: 'queued',
  step: 0,
  total: 4,
  error: null,
  runIds: {},
  result: null,
  requestedBy: { id: 'u1', name: 'Rahat Kalim', role: 'Reviewer' },
  createdAt,
  startedAt: null,
  finishedAt: null
});

describe.skipIf(!url)('PrismaConsolidatedReviewRepository (Postgres)', () => {
  let db: Db;
  let repo: PrismaConsolidatedReviewRepository;
  const clean = () => db.consolidatedReview.deleteMany({ where: { groupKey: { in: KEYS } } });

  beforeAll(async () => {
    db = createDb(url!);
    repo = new PrismaConsolidatedReviewRepository(db);
    await clean();
  });
  afterAll(async () => {
    await clean();
    await db.$disconnect();
  });

  it('allows one queued or running review per group, even when two start at once', async () => {
    const started = await Promise.all([
      repo.createIfIdle(rec('it-c1', KEYS[0]!, '2026-11-01T10:00:00Z')),
      repo.createIfIdle(rec('it-c2', KEYS[0]!, '2026-11-01T10:00:01Z'))
    ]);
    expect(started.filter(Boolean)).toHaveLength(1);
    expect(await repo.createIfIdle(rec('it-c3', KEYS[1]!, '2026-11-01T10:00:02Z'))).toBe(true); // another group is unaffected
  });

  it('stores the result and the runs read, and lists groups without results', async () => {
    const first = (await repo.latest(KEYS[0]!, '2026-12-31'))!;
    const done = {
      ...first,
      status: 'done' as const,
      step: 4,
      runIds: { 'eng-1': 'run-1', 'eng-2': null },
      result: { links: [{ status: 'differs', difference: -800 }], summary: 'S' },
      finishedAt: '2026-11-01T10:05:00Z'
    };
    await repo.update(done);
    const back = (await repo.latestDone(KEYS[0]!, '2026-12-31'))!;
    expect(back.runIds).toEqual({ 'eng-1': 'run-1', 'eng-2': null });
    expect(back.result).toEqual({ links: [{ status: 'differs', difference: -800 }], summary: 'S' });
    const listed = (await repo.latestAll()).filter((r) => KEYS.includes(r.groupKey));
    expect(listed).toHaveLength(2);
    expect(listed.every((r) => r.result === null)).toBe(true);
    expect((await repo.listByStatus(['queued'])).some((r) => r.groupKey === KEYS[1])).toBe(true);
  });
});
