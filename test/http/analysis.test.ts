// Phase 6: the analysis runs on the api as a background job. Starting it answers at once with a queued
// job; the job reads the stored documents, runs the checks (and the AI steps where allowed), saves the
// points and the run, logs it, and reports each step on the event stream.
import { readFileSync } from 'node:fs';
import path from 'node:path';

import request from 'supertest';
import { describe, expect, it } from 'vitest';

import type { DomainEvent } from '../../src/application/ports/EventBus.js';
import { FIXTURES } from '../fixtures/analysis/scenarios.js';
import { ready, world, type World } from '../helpers/review.js';

const fixture = (f: string) => readFileSync(path.join(FIXTURES, f));

const start = (x: World, cookie: string, mode?: 'full' | 'nextDraft') =>
  request(x.w.app)
    .post(`/api/engagements/${x.eng.id}/analysis-jobs`)
    .set('Cookie', cookie)
    .send(mode ? { mode } : {});
const snapshot = async (x: World) => (await request(x.w.app).get(`/api/engagements/${x.eng.id}/review`).set('Cookie', x.preparer)).body;

/** The five documents uploaded as the preparer and checked as the browser checks them, then marked ready. */
async function realDocuments(x: World) {
  const files: [string, string, string][] = [
    ['cy', 'meridian/cy.pdf', 'ABC draft FS 2025.pdf'],
    ['py', 'meridian/py.pdf', 'ABC signed FS 2024.pdf'],
    ['tb', 'meridian/tb.xlsx', 'ABC TB.xlsx'],
    ['is', 'meridian/is.xlsx', 'Custodian valuation.xlsx'],
    ['sup', 'meridian/sup.pdf', 'Board minutes.pdf']
  ];
  for (const [slot, file, name] of files) {
    const up = await request(x.w.app)
      .post(`/api/engagements/${x.eng.id}/documents`)
      .set('Cookie', x.preparer)
      .field('slot', slot)
      .attach('file', fixture(file), name);
    expect(up.status).toBe(200);
    await request(x.w.app)
      .put(`/api/documents/${up.body.version.id}/validation`)
      .set('Cookie', x.preparer)
      .send({ validation: { status: 'recognised', summary: 'Recognised', checks: [], localReadable: true } });
  }
  const wf = await request(x.w.app).put(`/api/engagements/${x.eng.id}/workflow`).set('Cookie', x.preparer).send({ state: 'ready' });
  expect(wf.status).toBe(200);
}

async function turnAiOn(x: World) {
  const on = await request(x.w.app)
    .put('/api/ai/settings')
    .set('Cookie', x.admin)
    .send({
      settings: {
        enabled: true,
        acknowledgement: { by: { id: 'a', name: 'Hamza' }, at: '2026-10-28T10:00:00Z' },
        model: 'claude-sonnet-5-5'
      }
    });
  expect(on.status).toBe(200);
}

describe('analysis on the server (UAT D1, D2)', { timeout: 30_000 }, () => {
  it('runs the sample documents in the background, reports each step, saves the points and the run, and logs it', async () => {
    const x = await world();
    expect((await start(x, x.reviewer)).body.error.message).toBe('The documents must be marked ready for review before they are analysed.');
    await ready(x);
    expect((await start(x, x.preparer)).status).toBe(403); // a Preparer cannot run the analysis

    const seen: DomainEvent[] = [];
    const off = x.w.events.subscribe((e) => {
      if (e.topic === 'analysis_jobs') seen.push(e);
    });
    const res = await start(x, x.reviewer);
    expect(res.status).toBe(202);
    expect(res.body.job).toMatchObject({
      engagementId: x.eng.id,
      mode: 'full',
      status: 'queued',
      step: 0,
      total: 8,
      requestedBy: { name: 'Rahat Kalim' }
    });
    await x.w.queue.idle();
    off();

    const job = (await request(x.w.app).get(`/api/analysis-jobs/${res.body.job.id}`).set('Cookie', x.preparer)).body.job;
    expect(job).toMatchObject({ status: 'done', step: 8, error: null });
    expect(seen.map((e) => e.data?.status)).toEqual(['queued', 'running', ...Array(8).fill('running'), 'done']);
    expect(seen.map((e) => e.data?.step)).toEqual([0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 8]);

    const snap = await snapshot(x);
    expect(snap.analysisJob).toMatchObject({ id: job.id, status: 'done', runId: snap.latestRun.id });
    expect(snap.latestRun.result).toMatchObject({ demo: true, version: 2 });
    expect(snap.latestRun.by).toMatchObject({ name: 'Rahat Kalim' });
    expect(snap.points.map((p: { ref: string }) => p.ref)).toEqual(['RP-01', 'RP-02', 'RP-03', 'RP-04', 'RP-05', 'RP-06', 'RP-07']);
    expect(snap.points[0]).toMatchObject({ source: 'analysis', assignedTo: { name: 'Muhammad Salman' } });
    expect(x.w.log.entries.find((e) => e.category === 'Analysis')).toMatchObject({
      summary: 'Ran the analysis on ABC Fund (draft v2)',
      actor: { name: 'Rahat Kalim' }
    });

    // D2: nothing changed, so no second run
    expect((await start(x, x.reviewer)).body.error.message).toBe(
      'Nothing has changed since the last analysis. Attach a new version of a document to analyse again.'
    );
    expect((await request(x.w.app).get('/api/analysis-jobs/nope').set('Cookie', x.preparer)).status).toBe(404);
  });

  it('one analysis per fund at a time', async () => {
    const x = await world();
    await ready(x);
    const running = {
      id: 'j-1',
      engagementId: x.eng.id,
      mode: 'full' as const,
      status: 'running' as const,
      step: 3,
      total: 8,
      error: null,
      runId: null
    };
    await x.w.jobs.create({
      ...running,
      requestedBy: { id: 'u', name: 'Ali Awan', role: 'Manager' },
      createdAt: '2026-10-28T10:00:00.000Z',
      startedAt: null,
      finishedAt: null
    });
    const second = await start(x, x.reviewer);
    expect(second.status).toBe(409);
    expect(second.body.error.message).toBe('An analysis of this fund is already running.');
    expect((await snapshot(x)).analysisJob).toMatchObject({ id: 'j-1', status: 'running', step: 3 });
  });

  it('reads real documents on the server without AI when the client does not permit it (UAT I2)', async () => {
    const x = await world({ aiPermitted: false });
    await realDocuments(x);
    const res = await start(x, x.reviewer);
    expect(res.status).toBe(202);
    await x.w.queue.idle();
    const snap = await snapshot(x);
    expect(snap.analysisJob.status).toBe('done');
    const result = snap.latestRun.result;
    expect(result.aiReads).toEqual({ read: [], reused: [], local: expect.arrayContaining(['cy', 'py', 'tb', 'is', 'sup']) });
    expect(result.aiSkipped).toEqual(['Narrative review', 'Variance explanations']);
    expect(result.K).toMatchObject({ statedNote4: 487414905, tbDr: 555581395, mgmtRate: 0.0075 });
    const titles = snap.points.map((p: { content: { title: string } }) => p.content.title);
    expect(titles).toContain('Investment note agrees to the custodian schedule — difference of £1,200,000');
    expect(titles).toContain('Management fee at the prospectus rate — difference of £241,955');
    expect(x.w.ai.calls).toHaveLength(0);
    expect(Object.keys(snap.latestRun.documentVersions).sort()).toEqual(['cy', 'is', 'py', 'sup', 'tb']);
  });

  it('a document that must be read by AI is refused with the reason when AI is not available (UAT I2)', async () => {
    const x = await world({ aiPermitted: false });
    await realDocuments(x);
    await request(x.w.app)
      .put(`/api/engagements/${x.eng.id}/workflow`)
      .set('Cookie', x.reviewer)
      .send({ state: 'returned', reason: 'Fix' });
    const cy = (await snapshot(x)).current.cy;
    await request(x.w.app)
      .put(`/api/documents/${cy.id}/validation`)
      .set('Cookie', x.preparer)
      .send({ validation: { status: 'recognised', summary: 'Recognised', checks: [], localReadable: false } });
    await request(x.w.app).put(`/api/engagements/${x.eng.id}/workflow`).set('Cookie', x.preparer).send({ state: 'ready' });
    const res = await start(x, x.reviewer);
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(
      /^The client does not permit AI, so this fund is reviewed without AI\. Real documents can be attached/
    );
  });

  it('with AI permitted, narrative points are drafted by AI and every call is logged with tokens (UAT I1)', async () => {
    const x = await world();
    await turnAiOn(x);
    x.w.ai.answer = {
      points: [
        {
          pri: 'Medium',
          area: 'Related party',
          title: 'Director who resigned is still listed',
          basis: 'Minutes',
          amount: null,
          refs: 'Note 6',
          follow: 'Amend'
        }
      ],
      lines: []
    };
    await realDocuments(x);
    await start(x, x.reviewer);
    await x.w.queue.idle();
    const snap = await snapshot(x);
    expect(snap.analysisJob.status).toBe('done');
    const ai = snap.points.find((p: { content: { title: string } }) => p.content.title === 'Director who resigned is still listed');
    expect(ai.content).toMatchObject({ aiDrafted: true, source: 'narrative' });
    const calls = x.w.log.entries.filter((e) => e.category === 'AI' && e.usage);
    expect(calls.map((e) => e.summary)).toEqual(['AI: Narrative review', 'AI: Variance explanations']);
    expect(calls[0]).toMatchObject({
      engagementId: x.eng.id,
      fundName: 'ABC Fund',
      actor: { name: 'Rahat Kalim' },
      usage: { input: 1000, output: 100 }
    });
  });

  it('a failure is reported on the job and in the log, with a plain reason', async () => {
    const x = await world();
    await turnAiOn(x);
    x.w.ai.structured = async () => {
      throw Object.assign(new Error('overloaded'), { status: 529 });
    };
    await realDocuments(x);
    await start(x, x.reviewer);
    await x.w.queue.idle();
    const snap = await snapshot(x);
    expect(snap.analysisJob.status).toBe('failed');
    expect(snap.analysisJob.error).toBeTruthy();
    expect(snap.latestRun).toBeNull();
    expect(x.w.log.entries.find((e) => e.summary === 'Analysis failed on ABC Fund')).toMatchObject({ details: snap.analysisJob.error });
  });

  it('after a restart, a job that was running is marked failed and a queued one runs', async () => {
    const x = await world();
    await ready(x);
    const base = {
      engagementId: x.eng.id,
      mode: 'full' as const,
      step: 0,
      total: 8,
      error: null,
      runId: null,
      requestedBy: { id: 'u', name: 'Rahat Kalim', role: 'Reviewer' }
    };
    await x.w.jobs.create({
      ...base,
      id: 'j-run',
      status: 'running',
      createdAt: '2026-10-28T10:00:00.000Z',
      startedAt: '2026-10-28T10:00:01.000Z',
      finishedAt: null
    });
    const reviewer = (await x.w.users.findByUsername('rahat.kalim'))!;
    await x.w.jobs.create({
      ...base,
      id: 'j-wait',
      status: 'queued',
      requestedBy: { id: reviewer.id, name: reviewer.name, role: reviewer.role },
      createdAt: '2026-10-28T10:00:02.000Z',
      startedAt: null,
      finishedAt: null
    });
    expect(await x.w.recoverJobs.execute()).toEqual({ failed: 1, requeued: 1 });
    expect(await x.w.jobs.findById('j-run')).toMatchObject({
      status: 'failed',
      error: 'The server restarted while this analysis was running. Run it again.'
    });
    await x.w.queue.idle();
    expect(await x.w.jobs.findById('j-wait')).toMatchObject({ status: 'done', step: 8 });
  });
});
