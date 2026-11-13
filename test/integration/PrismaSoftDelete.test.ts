// Deleting a fund against a real Postgres (DATABASE_URL_TEST): the engagement repository leaves a deleted fund out
// of every ordinary read, the aggregate reads (portfolio, bell), the shared points and the job recovery leave its rows
// out, and a restore brings them all back. Rows are removed afterwards.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type Db } from '../../src/infrastructure/db/prisma.js';
import { PrismaAnalysisJobRepository } from '../../src/infrastructure/db/repositories/PrismaAnalysisJobRepository.js';
import { PrismaAnalysisRunRepository } from '../../src/infrastructure/db/repositories/PrismaAnalysisRunRepository.js';
import { PrismaBellReadModel } from '../../src/infrastructure/db/repositories/PrismaBellReadModel.js';
import { PrismaEngagementRepository } from '../../src/infrastructure/db/repositories/PrismaEngagementRepository.js';
import { PrismaPointRepository } from '../../src/infrastructure/db/repositories/PrismaPointRepositories.js';
import { PrismaPortfolioReadModel } from '../../src/infrastructure/db/repositories/PrismaPortfolioReadModel.js';
import { PrismaSignoffRepository } from '../../src/infrastructure/db/repositories/PrismaSignoffRepository.js';
import { PrismaWorkflowRepository } from '../../src/infrastructure/db/repositories/PrismaWorkflowRepository.js';

const url = process.env.DATABASE_URL_TEST;
const [GONE, KEPT] = ['eng-softdel-gone', 'eng-softdel-kept'];
const ENGS = [GONE, KEPT];
const at = '2026-11-01T10:00:00.000Z';
const d = (s: string) => new Date(s);
const USER = 'u-softdel';

describe.skipIf(!url)('Deleting a fund (Postgres)', () => {
  let db: Db;
  let engagements: PrismaEngagementRepository;
  const wipe = async () => {
    await db.pointMessage.deleteMany({ where: { engagementId: { in: ENGS } } });
    await db.reviewPoint.deleteMany({ where: { engagementId: { in: ENGS } } });
    await db.documentVersion.deleteMany({ where: { engagementId: { in: ENGS } } });
    await db.workflow.deleteMany({ where: { engagementId: { in: ENGS } } });
    await db.analysisJob.deleteMany({ where: { engagementId: { in: ENGS } } });
    await db.analysisJob.deleteMany({ where: { id: 'j-softdel-late' } });
    await db.engagement.deleteMany({ where: { id: { in: ENGS } } });
  };
  beforeAll(async () => {
    db = createDb(url!);
    engagements = new PrismaEngagementRepository(db);
    await wipe();
    for (const id of ENGS) {
      const doc = { id, fund: { name: `Fund ${id}`, yearEnd: '2026-12-31', currency: 'GBP' } };
      await engagements.create({ doc, createdBy: null, createdAt: at, updatedBy: null, updatedAt: at });
      await db.documentVersion.create({
        data: {
          id: `v-${id}`,
          engagementId: id,
          slot: 'cy',
          version: 1,
          fileName: 'cy.pdf',
          size: 1,
          sha256: id,
          sample: true,
          uploadedAt: d(at)
        }
      });
      await db.workflow.create({ data: { engagementId: id, state: 'ready', at: d(at), reason: '', history: [] } });
      await db.reviewPoint.create({
        data: {
          id: `p-${id}`,
          engagementId: id,
          ref: 'RP-01',
          title: 'Matter',
          source: 'manual',
          content: { title: 'Matter' },
          status: 'open',
          type: 'change',
          assignedTo: { id: USER, name: 'P', role: 'Preparer' },
          raisedAt: d(at),
          updatedAt: d(at),
          sharedGroupId: 'grp-softdel'
        }
      });
      await db.pointMessage.create({
        data: {
          id: `m-${id}`,
          pointId: `p-${id}`,
          engagementId: id,
          kind: 'comment',
          author: { id: USER, name: 'P', role: 'Preparer' },
          at: d(at),
          text: 'Hello',
          attachments: []
        }
      });
      await db.analysisJob.create({
        data: {
          id: `j-${id}`,
          engagementId: id,
          mode: 'full',
          status: 'queued',
          total: 8,
          requestedBy: { id: USER, name: 'P', role: 'Reviewer' },
          createdAt: d(at)
        }
      });
    }
  });
  afterAll(async () => {
    await wipe();
    await db.$disconnect();
  });

  it('a delete and an analysis start cannot both win: each refuses while the other holds', async () => {
    const by = { id: USER, name: 'Hamza Mehmood', role: 'Administrator' };
    // the fund has a queued analysis (created in beforeAll): the delete is refused inside its own transaction
    await expect(engagements.markDeleted(GONE, { at, by, reason: null })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await engagements.findById(GONE)).not.toBeNull();
    // and a start for a deleted fund is refused inside the start's transaction
    await db.analysisJob.update({ where: { id: `j-${GONE}` }, data: { status: 'done' } });
    expect(await engagements.markDeleted(GONE, { at, by, reason: null })).toBe(true);
    const jobs = new PrismaAnalysisJobRepository(db);
    const job = {
      id: 'j-softdel-late',
      engagementId: GONE,
      mode: 'full' as const,
      status: 'queued' as const,
      step: 0,
      total: 8,
      error: null,
      runId: null,
      requestedBy: { id: USER, name: 'P', role: 'Reviewer' },
      createdAt: at,
      startedAt: null,
      finishedAt: null
    };
    await expect(jobs.createIfIdle(job)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await jobs.findById('j-softdel-late')).toBeNull();
    // a late save is refused too
    const rec = (await engagements.findIncludingDeleted(GONE))!;
    await expect(engagements.update(rec)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    // back to the state the next test starts from
    expect(await engagements.restore(GONE, USER, at)).toBe(true);
    await db.analysisJob.update({ where: { id: `j-${GONE}` }, data: { status: 'queued' } });
  });

  it('hides the fund from every ordinary read, keeps who, when and why, and restores it', async () => {
    const by = { id: USER, name: 'Hamza Mehmood', role: 'Administrator' };
    // a queued analysis would block the delete
    await db.analysisJob.update({ where: { id: `j-${GONE}` }, data: { status: 'done' } });
    expect(await engagements.markDeleted(GONE, { at, by, reason: 'Duplicate' })).toBe(true);
    expect(await engagements.markDeleted(GONE, { at, by, reason: 'Again' })).toBe(false);

    expect((await engagements.list()).map((r) => r.doc.id)).not.toContain(GONE);
    expect(await engagements.findById(GONE)).toBeNull();
    expect(await engagements.findDuplicate(null, `Fund ${GONE}`, '2026-12-31', null)).toBeNull();
    expect((await engagements.findIncludingDeleted(GONE))!.deleted).toEqual({ at, by, reason: 'Duplicate' });
    expect((await engagements.findIncludingDeleted(KEPT))!.deleted).toBeNull();
    expect((await engagements.listDeleted()).map((r) => r.doc.id)).toContain(GONE);

    // a late save never reaches a deleted fund
    const rec = (await engagements.findIncludingDeleted(GONE))!;
    await expect(engagements.update({ ...rec, doc: { ...rec.doc, fund: { ...rec.doc.fund, name: 'Renamed' } } })).rejects.toMatchObject({
      code: 'NOT_FOUND'
    });
    expect((await engagements.findIncludingDeleted(GONE))!.doc.fund.name).toBe(`Fund ${GONE}`);

    // the aggregate and cross-fund reads leave its rows out
    const portfolio = await new PrismaPortfolioReadModel(db).activity('2026-11-13');
    expect(portfolio.map((f) => f.engagementId)).toContain(KEPT);
    expect(portfolio.map((f) => f.engagementId)).not.toContain(GONE);
    const bell = await new PrismaBellReadModel(db, {
      workflows: new PrismaWorkflowRepository(db),
      signoffs: new PrismaSignoffRepository(db),
      runs: new PrismaAnalysisRunRepository(db)
    }).reviews(USER, '2026-10-01T00:00:00.000Z');
    expect(bell[KEPT]!.points.map((p) => p.id)).toEqual([`p-${KEPT}`]);
    expect(bell[KEPT]!.messages.map((m) => m.id)).toEqual([`m-${KEPT}`]);
    expect(bell[GONE]?.points ?? []).toEqual([]);
    expect(bell[GONE]?.messages ?? []).toEqual([]);
    expect(bell[GONE]?.versions ?? []).toEqual([]);
    const points = new PrismaPointRepository(db);
    expect((await points.listBySharedGroups(['grp-softdel'])).map((p) => p.id)).toEqual([`p-${KEPT}`]);
    const jobs = new PrismaAnalysisJobRepository(db);
    // (a job left queued by a crash at the moment of the delete) is never picked up
    await db.analysisJob.update({ where: { id: `j-${GONE}` }, data: { status: 'queued' } });
    const queued = (await jobs.listByStatus(['queued'])).map((j) => j.id);
    expect(queued).toContain(`j-${KEPT}`);
    expect(queued).not.toContain(`j-${GONE}`);
    // its own rows are all still there
    expect(await points.findById(`p-${GONE}`)).not.toBeNull();

    // restored
    expect(await engagements.restore(GONE, USER, '2026-11-02T10:00:00.000Z')).toBe(true);
    expect(await engagements.restore(GONE, USER, '2026-11-02T10:00:00.000Z')).toBe(false);
    const back = (await engagements.findIncludingDeleted(GONE))!;
    expect(back.deleted).toBeNull();
    expect(back.updatedBy).toBe(USER);
    expect((await engagements.findById(GONE))!.doc.fund.name).toBe(`Fund ${GONE}`);
    expect((await points.listBySharedGroups(['grp-softdel'])).map((p) => p.id).sort()).toEqual([`p-${GONE}`, `p-${KEPT}`].sort());
    expect((await jobs.listByStatus(['queued'])).map((j) => j.id)).toContain(`j-${GONE}`);
    expect((await new PrismaPortfolioReadModel(db).activity('2026-11-13')).map((f) => f.engagementId)).toContain(GONE);
  });
});
