// Starting analyses against a real Postgres (DATABASE_URL_TEST). Found by the 50-fund load test: starts for
// different funds at the same moment made the serializable transaction fail, and the api refused them as if the
// fund were busy. Rows are created for test engagements and removed afterwards.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { AnalysisJob } from '../../src/application/ports/AnalysisJobRepository.js';
import { createDb, type Db } from '../../src/infrastructure/db/prisma.js';
import { PrismaAnalysisJobRepository } from '../../src/infrastructure/db/repositories/PrismaAnalysisJobRepository.js';

const url = process.env.DATABASE_URL_TEST;
const FUNDS = Array.from({ length: 10 }, (_, i) => `eng-jobs-test-${i}`);
const at = new Date('2026-10-29T00:00:00Z');

const job = (id: string, engagementId: string): AnalysisJob => ({
  id,
  engagementId,
  mode: 'full',
  status: 'queued',
  step: 0,
  total: 5,
  error: null,
  runId: null,
  requestedBy: { id: 'u1', name: 'Rahat Kalim', role: 'Reviewer' },
  createdAt: at.toISOString(),
  startedAt: null,
  finishedAt: null
});

describe.skipIf(!url)('PrismaAnalysisJobRepository (Postgres)', () => {
  let db: Db;
  const wipe = async () => {
    await db.analysisJob.deleteMany({ where: { engagementId: { in: FUNDS } } });
    await db.engagement.deleteMany({ where: { id: { in: FUNDS } } });
  };
  beforeAll(async () => {
    db = createDb(url!);
    await wipe();
    await db.engagement.createMany({
      data: FUNDS.map((id) => ({ id, fundName: id, yearEnd: '2026-12-31', currency: 'GBP', data: {}, createdAt: at, updatedAt: at }))
    });
  });
  afterAll(async () => {
    await wipe();
    await db.$disconnect();
  });

  it('starts analyses of different funds at the same moment, and only one per fund', async () => {
    const repo = new PrismaAnalysisJobRepository(db);
    const started = await Promise.all(FUNDS.map((f) => repo.createIfIdle(job(`job-${f}`, f))));
    expect(started).toEqual(FUNDS.map(() => true));

    const again = await Promise.all([repo.createIfIdle(job('job-again-a', FUNDS[0]!)), repo.createIfIdle(job('job-again-b', FUNDS[1]!))]);
    expect(again).toEqual([false, false]); // both funds already have a queued job

    await db.analysisJob.updateMany({ where: { engagementId: FUNDS[2]! }, data: { status: 'done' } });
    const twice = await Promise.all([repo.createIfIdle(job('job-twice-a', FUNDS[2]!)), repo.createIfIdle(job('job-twice-b', FUNDS[2]!))]);
    expect(twice.filter(Boolean)).toHaveLength(1);
    expect(await db.analysisJob.count({ where: { engagementId: FUNDS[2]!, status: 'queued' } })).toBe(1);
  });
});
