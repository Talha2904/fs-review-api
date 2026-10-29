// Regression tests for the findings of the Phase 0 to 6 audit (28 Oct 2026). Each test names the finding.
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { actorOf } from '../../src/domain/identity/User.js';
import { cookieOf } from '../helpers/fakes.js';
import { PW, ready, world, type World } from '../helpers/review.js';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n');

/** What a finished analysis saves, through the same use cases the job uses. */
async function analysed(x: World, points: object[] = []) {
  const reviewer = actorOf((await x.w.users.findByUsername('rahat.kalim'))!);
  const matrix = await x.w.permissions.get();
  await x.w.uc.syncAnalysisPoints.execute(reviewer, matrix, x.eng.id, points as never, null, 1);
  await x.w.uc.saveAnalysisRun.execute(reviewer, matrix, x.eng.id, { result: { version: 1, points }, analysedAt: '', settingsSig: '{}' });
}
const signoff = (x: World, cookie: string, body: object) =>
  request(x.w.app).post(`/api/engagements/${x.eng.id}/signoff`).set('Cookie', cookie).send(body);

describe('sign-off integrity', () => {
  it('a locked review cannot be edited, so the partner step cannot be switched off after the Manager signs', async () => {
    const x = await world({ partnerSignoff: true });
    await ready(x);
    await analysed(x);
    expect((await signoff(x, x.manager, { state: 'manager-signed', text: 'ok' })).status).toBe(200);
    const doc = (await x.w.engagements.findById(x.eng.id))!.doc;
    const edit = await request(x.w.app)
      .put(`/api/engagements/${x.eng.id}`)
      .set('Cookie', x.manager)
      .send({ ...doc, partnerSignoff: 'off' });
    expect(edit.status).toBe(423);
    // even if the client's setting changes, the partner step that was started still applies
    const ent = await x.w.entities.findById(x.ent.id);
    await x.w.entities.update({ ...ent!, doc: { ...ent!.doc, partnerSignoff: false } });
    expect((await signoff(x, x.manager, { state: 'signed', text: 'final' })).status).toBe(403);
    expect((await signoff(x, x.partner, { state: 'signed', text: 'Partner agreed' })).body.signoff.state).toBe('signed');
  });

  it('the partner sign-off is given by someone other than the Manager who signed (an Administrator holds both roles)', async () => {
    const x = await world({ partnerSignoff: true });
    await ready(x);
    await analysed(x);
    await signoff(x, x.admin, { state: 'manager-signed', text: 'ok' });
    expect((await signoff(x, x.admin, { state: 'signed', text: 'final' })).body.error.message).toBe(
      'The partner sign-off must be given by someone other than the Manager who signed off.'
    );
  });

  it('sign-off needs an analysis of the documents as they are now', async () => {
    const x = await world();
    await ready(x);
    await analysed(x, [{ ref: 'RP-01', title: 'Note 4 differs' }]);
    const point = [...x.w.points.rows.values()][0]!;
    await request(x.w.app)
      .post(`/api/engagements/${x.eng.id}/documents`)
      .set('Cookie', x.preparer)
      .field('slot', 'cy')
      .field('responseTo', point.id)
      .attach('file', PDF, 'draft v2.pdf');
    await request(x.w.app).post(`/api/points/${point.id}/act`).set('Cookie', x.preparer).send({ kind: 'response', text: 'Fixed' });
    await request(x.w.app).post(`/api/points/${point.id}/act`).set('Cookie', x.reviewer).send({ kind: 'clear', text: 'ok' });
    expect((await signoff(x, x.manager, { state: 'signed', text: 'final' })).body.error.message).toBe(
      'The documents changed since the last analysis (Current Year Draft Financial Statements). Run the analysis again before signing off.'
    );
  });

  it('a review report is filed only after the final sign-off', async () => {
    const x = await world();
    const r = await request(x.w.app)
      .post(`/api/engagements/${x.eng.id}/reports`)
      .set('Cookie', x.manager)
      .attach('file', PDF, 'report.pdf');
    expect(r.body.error.message).toBe('The review report is filed at the final sign-off.');
  });
});

describe('documents', () => {
  it('a check cannot mark a document as a built-in sample, nor change a removed version', async () => {
    const x = await world();
    const up = await request(x.w.app)
      .post(`/api/engagements/${x.eng.id}/documents`)
      .set('Cookie', x.preparer)
      .field('slot', 'cy')
      .attach('file', PDF, 'd.pdf');
    const put = (status: string) =>
      request(x.w.app)
        .put(`/api/documents/${up.body.version.id}/validation`)
        .set('Cookie', x.preparer)
        .send({ validation: { status, summary: 's', checks: [] } });
    expect((await put('sample')).status).toBe(400);
    expect((await put('recognised')).status).toBe(200);
    await request(x.w.app).delete(`/api/engagements/${x.eng.id}/documents/cy`).set('Cookie', x.preparer);
    expect((await put('recognised')).body.error.message).toBe('That version was removed.');
  });

  it('when the latest version is removed the slot is empty everywhere, so it cannot be marked ready on an older one', async () => {
    const x = await world();
    for (const slot of ['py', 'tb', 'is'])
      await request(x.w.app).post(`/api/engagements/${x.eng.id}/documents/sample`).set('Cookie', x.preparer).send({ slot, name: slot });
    await request(x.w.app).post(`/api/engagements/${x.eng.id}/documents/sample`).set('Cookie', x.preparer).send({ slot: 'cy', name: 'v1' });
    await request(x.w.app).post(`/api/engagements/${x.eng.id}/documents/sample`).set('Cookie', x.preparer).send({ slot: 'cy', name: 'v2' });
    await request(x.w.app).delete(`/api/engagements/${x.eng.id}/documents/cy`).set('Cookie', x.preparer);
    const snap = await request(x.w.app).get(`/api/engagements/${x.eng.id}/review`).set('Cookie', x.preparer);
    expect(snap.body.current.cy).toBeUndefined();
    const wf = await request(x.w.app).put(`/api/engagements/${x.eng.id}/workflow`).set('Cookie', x.preparer).send({ state: 'ready' });
    expect(wf.body.error.message).toBe('Attach every required document before marking them ready.');
  });
});

describe('access and the HTTP layer', () => {
  it('Finance sees billing only, never review content', async () => {
    const x = await world();
    await ready(x);
    for (const path of ['/api/reviews', `/api/engagements/${x.eng.id}/review`, '/api/events'])
      expect((await request(x.w.app).get(path).set('Cookie', x.finance)).status).toBe(403);
    const v = [...x.w.documents.rows.values()][0]!;
    expect((await request(x.w.app).get(`/api/documents/${v.id}/file`).set('Cookie', x.finance)).status).toBe(403);
  });

  it('a write from another site is refused (CSRF); the app’s own origin is accepted', async () => {
    const x = await world();
    const evil = await request(x.w.app).post('/api/auth/logout').set('Cookie', x.manager).set('Origin', 'https://evil.example');
    expect(evil.status).toBe(403);
    const crossSite = await request(x.w.app).post('/api/auth/logout').set('Cookie', x.manager).set('Sec-Fetch-Site', 'cross-site');
    expect(crossSite.status).toBe(403);
    expect((await request(x.w.app).post('/api/auth/logout').set('Cookie', x.manager).set('Origin', 'http://localhost:5173')).status).toBe(
      200
    );
  });

  it('a malformed session cookie is no session, not a server error', async () => {
    const x = await world();
    expect((await request(x.w.app).get('/api/auth/me').set('Cookie', 'fsr_session=%E0')).status).toBe(200);
  });

  it('the browser may only write its own kinds of activity entries', async () => {
    const x = await world();
    const forged = await request(x.w.app)
      .post('/api/activity')
      .set('Cookie', x.preparer)
      .send({ category: 'Users', summary: 'Made Hamza an Administrator' });
    expect(forged.status).toBe(400);
  });

  it('sign-in attempts are limited per address and per username, and a block is logged once', async () => {
    const x = await world();
    for (let i = 0; i < 5; i++) await request(x.w.app).post('/api/auth/login').send({ username: 'ali.awan', password: 'wrong-password' });
    for (let i = 0; i < 3; i++)
      expect((await request(x.w.app).post('/api/auth/login').send({ username: 'ali.awan', password: PW })).status).toBe(429);
    expect(x.w.log.entries.filter((e) => /^Sign-in blocked/.test(e.summary))).toHaveLength(1);
  });

  it('a reset link works once, and no longer works after the person’s email changes', async () => {
    const x = await world();
    const u = (await x.w.users.findByUsername('ali.awan'))!;
    await x.w.users.update({ ...u, email: 'ali@firm.test' });
    await request(x.w.app).post('/api/auth/forgot').send({ login: 'ali.awan' });
    const token = /reset=([A-Za-z0-9_-]+)/.exec(x.w.mailer.sent.at(-1)!.text)![1]!;
    const reset = (password: string) => request(x.w.app).post('/api/auth/reset').send({ token, password });
    const [a, b] = await Promise.all([reset('newpassword1'), reset('newpassword2')]);
    expect([a.status, b.status].sort()).toEqual([200, 400]);
    await request(x.w.app).post('/api/auth/forgot').send({ login: 'ali.awan' });
    const token2 = /reset=([A-Za-z0-9_-]+)/.exec(x.w.mailer.sent.at(-1)!.text)![1]!;
    await request(x.w.app).patch(`/api/users/${u.id}`).set('Cookie', x.admin).send({ email: 'ali.awan@firm.test' });
    expect((await request(x.w.app).post('/api/auth/reset').send({ token: token2, password: 'newpassword3' })).status).toBe(400);
  });

  it('an Administrator who changes their own password ends their other sign-ins', async () => {
    const x = await world();
    const other = cookieOf(await request(x.w.app).post('/api/auth/login').send({ username: 'hamza.mehmood', password: PW }));
    const admin = (await x.w.users.findByUsername('hamza.mehmood'))!;
    expect((await request(x.w.app).patch(`/api/users/${admin.id}`).set('Cookie', x.admin).send({ password: 'anotherpass1' })).status).toBe(
      200
    );
    expect((await request(x.w.app).get('/api/auth/me').set('Cookie', other)).body.user).toBeNull();
    expect((await request(x.w.app).get('/api/auth/me').set('Cookie', x.admin)).body.user.username).toBe('hamza.mehmood');
  });
});

describe('analysis jobs', () => {
  it('documents cannot be sent back while an analysis runs, and a stuck job is given up', async () => {
    const x = await world();
    await ready(x);
    const reviewer = (await x.w.users.findByUsername('rahat.kalim'))!;
    await x.w.jobs.create({
      id: 'j-1',
      engagementId: x.eng.id,
      mode: 'full',
      status: 'running',
      step: 2,
      total: 8,
      error: null,
      runId: null,
      requestedBy: { id: reviewer.id, name: reviewer.name, role: reviewer.role },
      createdAt: '2026-10-28T09:00:00.000Z',
      startedAt: '2026-10-28T09:00:00.000Z',
      finishedAt: null
    });
    const back = await request(x.w.app)
      .put(`/api/engagements/${x.eng.id}/workflow`)
      .set('Cookie', x.reviewer)
      .send({ state: 'returned', reason: 'Fix' });
    expect(back.body.error.message).toBe('An analysis of this fund is running. Wait for it to finish.');
    expect(await x.w.recoverJobs.reapStale(30)).toBe(1); // the test clock is an hour later
    expect(await x.w.jobs.findById('j-1')).toMatchObject({
      status: 'failed',
      error: 'The analysis took too long and was stopped. Run it again.'
    });
  });
});
