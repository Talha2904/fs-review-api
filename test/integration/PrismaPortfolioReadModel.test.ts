// The portfolio's aggregate queries against a real Postgres (DATABASE_URL_TEST). Rows are created for one test
// engagement and removed afterwards.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type Db } from '../../src/infrastructure/db/prisma.js';
import { PrismaAnalysisRunRepository } from '../../src/infrastructure/db/repositories/PrismaAnalysisRunRepository.js';
import { PrismaBellReadModel } from '../../src/infrastructure/db/repositories/PrismaBellReadModel.js';
import { PrismaPortfolioReadModel } from '../../src/infrastructure/db/repositories/PrismaPortfolioReadModel.js';
import { PrismaSignoffRepository } from '../../src/infrastructure/db/repositories/PrismaSignoffRepository.js';
import { PrismaWorkflowRepository } from '../../src/infrastructure/db/repositories/PrismaWorkflowRepository.js';

const url = process.env.DATABASE_URL_TEST;
const ENG = 'eng-portfolio-test';
const at = (iso: string) => new Date(iso);

describe.skipIf(!url)('PrismaPortfolioReadModel (Postgres)', () => {
  let db: Db;
  const wipe = async () => {
    await db.pointMessage.deleteMany({ where: { engagementId: ENG } });
    await db.reviewPoint.deleteMany({ where: { engagementId: ENG } });
    await db.analysisRun.deleteMany({ where: { engagementId: ENG } });
    await db.workflow.deleteMany({ where: { engagementId: ENG } });
    await db.signoff.deleteMany({ where: { engagementId: ENG } });
    await db.documentVersion.deleteMany({ where: { engagementId: ENG } });
    await db.engagement.deleteMany({ where: { id: ENG } });
  };
  beforeAll(async () => {
    db = createDb(url!);
    await wipe();
    await db.engagement.create({
      data: {
        id: ENG,
        fundName: 'Portfolio Fund',
        yearEnd: '2026-12-31',
        currency: 'GBP',
        data: {},
        createdAt: at('2026-10-01T00:00:00Z'),
        updatedAt: at('2026-10-01T00:00:00Z')
      }
    });
    const doc = (id: string, slot: string, version: number, removed: boolean) => ({
      id,
      engagementId: ENG,
      slot,
      version,
      fileName: `${slot}.pdf`,
      size: 1,
      sha256: id,
      sample: false,
      uploadedAt: at(`2026-10-0${version}T09:00:00Z`),
      removedAt: removed ? at('2026-10-05T00:00:00Z') : null
    });
    await db.documentVersion.createMany({ data: [doc('d1', 'cy', 1, false), doc('d2', 'cy', 2, true), doc('d3', 'tb', 1, false)] });
    await db.workflow.create({ data: { engagementId: ENG, state: 'ready', at: at('2026-10-06T00:00:00Z'), reason: '', history: [] } });
    const point = (id: string, ref: string, status: string, dueDate: string | null) => ({
      id,
      engagementId: ENG,
      ref,
      title: ref,
      source: 'analysis',
      content: { title: ref },
      status,
      type: 'change',
      dueDate,
      ...(id === 'p2' ? { assignedTo: { id: 'u1', name: 'Muhammad Salman', role: 'Preparer' } } : {}),
      raisedAt: at('2026-10-07T00:00:00Z'),
      updatedAt: at('2026-10-07T00:00:00Z')
    });
    await db.reviewPoint.createMany({
      data: [
        point('p1', 'RP-01', 'open', '2026-10-20'),
        point('p2', 'RP-02', 'responded', null),
        point('p3', 'RP-03', 'cleared', '2026-10-01')
      ]
    });
    await db.analysisRun.create({
      data: {
        id: 'r1',
        engagementId: ENG,
        draftVersion: 1,
        result: {},
        analysedAt: at('2026-10-07T00:00:00Z'),
        settingsSig: '',
        documentVersions: {},
        at: at('2026-10-07T00:00:00Z')
      }
    });
    await db.pointMessage.create({
      data: { id: 'm1', pointId: 'p2', engagementId: ENG, kind: 'response', at: at('2026-10-09T12:00:00Z'), text: 'done', attachments: [] }
    });
  });
  afterAll(async () => {
    await wipe();
    await db.$disconnect();
  });

  it('counts points by status, finds overdue ones and the latest activity, and knows which slots are filled', async () => {
    const all = await new PrismaPortfolioReadModel(db).activity('2026-10-28');
    expect(all.find((a) => a.engagementId === ENG)).toEqual({
      engagementId: ENG,
      hasDocuments: true, // tb is filled; cy's latest version was removed
      workflowState: 'ready',
      signoffState: 'none',
      analysed: true,
      openPoints: 2,
      respondedPoints: 1,
      overduePoints: 1, // the cleared point's past due date does not count
      lastActivityAt: '2026-10-09T12:00:00.000Z'
    });
  });

  it('reads the bell lean: titles from their column, and only the threads of the person’s own recent points', async () => {
    const bell = new PrismaBellReadModel(db, {
      workflows: new PrismaWorkflowRepository(db),
      signoffs: new PrismaSignoffRepository(db),
      runs: new PrismaAnalysisRunRepository(db)
    });
    const mine = (await bell.reviews('u1', '2026-10-01T00:00:00.000Z'))[ENG]!;
    expect(mine.points.map((p) => [p.ref, p.content?.title, p.status])).toEqual([
      ['RP-01', 'RP-01', 'open'],
      ['RP-02', 'RP-02', 'responded'],
      ['RP-03', 'RP-03', 'cleared']
    ]);
    expect(Object.keys(mine.current).sort()).toEqual(['tb']);
    expect(mine.workflow.state).toBe('ready');
    expect(mine.latestRun?.id).toBe('r1');
    expect(mine.messages.map((m) => m.id)).toEqual(['m1']); // on p2, assigned to u1
    expect((await bell.reviews('u2', '2026-10-01T00:00:00.000Z'))[ENG]!.messages).toEqual([]);
    expect((await bell.reviews('u1', '2026-10-10T00:00:00.000Z'))[ENG]!.messages).toEqual([]); // older than the window
  });
});
