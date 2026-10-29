import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { actorOf } from '../../src/domain/identity/User.js';
import { cookieOf } from '../helpers/fakes.js';
import { PW, ready, world, type World } from '../helpers/review.js';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n');

const preparerPerson = { id: 'p1', name: 'Muhammad Salman', role: 'Preparer' };
/** What a finished analysis job saves (the points, then the run), done as the Reviewer through the same use cases. */
const analysed = async (
  x: World,
  points: object[] = [{ ref: 'RP-01', title: 'Note 4 differs by £750,000', pri: 'High', area: 'Investments' }]
) => {
  const reviewer = actorOf((await x.w.users.findByUsername('rahat.kalim'))!);
  const matrix = await x.w.permissions.get();
  const sync = await x.w.uc.syncAnalysisPoints.execute(reviewer, matrix, x.eng.id, points as never, preparerPerson, 1);
  const run = await x.w.uc.saveAnalysisRun.execute(reviewer, matrix, x.eng.id, {
    result: { version: 1, points, K: { statedNA: 1 } },
    analysedAt: '2026-10-28T11:00:00.000Z',
    settingsSig: '{}'
  });
  return { sync, run };
};

describe('saved analysis runs and points (UAT D1, D2)', () => {
  it('records the run with the document versions it read; refuses before the documents are ready', async () => {
    const x = await world();
    const reviewer = actorOf((await x.w.users.findByUsername('rahat.kalim'))!);
    await expect(
      x.w.uc.saveAnalysisRun.execute(reviewer, await x.w.permissions.get(), x.eng.id, {
        result: { version: 1 },
        analysedAt: '',
        settingsSig: ''
      })
    ).rejects.toThrow('The documents must be marked ready for review before an analysis is recorded.');
    await ready(x);
    const { sync, run } = await analysed(x);
    expect(sync).toEqual({ created: 1 });
    expect(Object.keys(run.documentVersions).sort()).toEqual(['cy', 'is', 'py', 'tb']);
    const snap = await request(x.w.app).get(`/api/engagements/${x.eng.id}/review`).set('Cookie', x.preparer);
    expect(snap.body.latestRun.result.K.statedNA).toBe(1);
    expect(snap.body.points[0]).toMatchObject({
      ref: 'RP-01',
      status: 'open',
      source: 'analysis',
      type: 'change',
      assignedTo: { name: 'Muhammad Salman' }
    });
    expect(snap.body.messages.map((m: { kind: string }) => m.kind)).toEqual(['raise', 'assign']);
    const all = await request(x.w.app).get('/api/reviews').set('Cookie', x.preparer);
    expect(all.body.reviews[x.eng.id].latestRun.result).toBeUndefined(); // light listing
    expect(all.body.reviews[x.eng.id].points).toHaveLength(1);
    // the browser can no longer post its own results
    expect(
      (await request(x.w.app).post(`/api/engagements/${x.eng.id}/analysis-runs`).set('Cookie', x.reviewer).send({ result: {} })).status
    ).toBe(404);
    expect(
      (await request(x.w.app).put(`/api/engagements/${x.eng.id}/points/sync`).set('Cookie', x.reviewer).send({ points: [] })).status
    ).toBe(404);
  });

  it('a second analysis keeps existing points and notes the re-test; a new ref is a new point', async () => {
    const x = await world();
    await ready(x);
    await analysed(x);
    await request(x.w.app)
      .post(`/api/points/${x.w.points.rows.values().next().value!.id}/act`)
      .set('Cookie', x.preparer)
      .send({ kind: 'response', text: 'Fixed' });
    const second = await analysed(x, [
      { ref: 'RP-01', title: 'Note 4 differs by £750,000', agent: 'resolved', agentNote: 'The note now agrees.' },
      { ref: 'RP-02', title: 'Fee differs', area: 'Fees' }
    ]);
    expect(second.sync.created).toBe(1);
    const snap = await request(x.w.app).get(`/api/engagements/${x.eng.id}/review`).set('Cookie', x.preparer);
    expect(snap.body.points.map((p: { ref: string; status: string }) => [p.ref, p.status])).toEqual([
      ['RP-01', 'responded'],
      ['RP-02', 'open']
    ]);
    const notes = snap.body.messages.filter((m: { kind: string }) => m.kind === 'note');
    expect(notes[0].text).toMatch(/appears resolved/);
  });
});

describe('review points (UAT E1 to E5)', () => {
  it('respond with a revised document and evidence, reopen, respond again, clear: every step in the thread', async () => {
    const x = await world();
    await ready(x);
    await analysed(x);
    const point = [...x.w.points.rows.values()][0]!;
    // the Preparer attaches a revised trial balance while the documents are locked, via the response
    const revised = await request(x.w.app)
      .post(`/api/engagements/${x.eng.id}/documents`)
      .set('Cookie', x.preparer)
      .field('slot', 'cy')
      .field('responseTo', point.id)
      .attach('file', PDF, 'draft v2.pdf');
    expect(revised.status).toBe(200);
    // without naming an open point it is refused, as is any other upload while the documents are ready
    const loose = await request(x.w.app)
      .post(`/api/engagements/${x.eng.id}/documents`)
      .set('Cookie', x.preparer)
      .field('slot', 'tb')
      .attach('file', PDF, 'tb.pdf');
    expect(loose.status).toBe(400);
    const unknown = await request(x.w.app)
      .post(`/api/engagements/${x.eng.id}/documents`)
      .set('Cookie', x.preparer)
      .field('slot', 'cy')
      .field('responseTo', 'no-such-point')
      .attach('file', PDF, 'draft v3.pdf');
    expect(unknown.body.error.message).toBe('That review point was not found on this fund.');
    expect(revised.body.version.version).toBe(2);
    const ev = await request(x.w.app)
      .post(`/api/points/${point.id}/evidence`)
      .set('Cookie', x.preparer)
      .attach('file', Buffer.from('hello'), 'bank letter.txt');
    expect(ev.status).toBe(200);
    expect(ev.body.evidence).toMatchObject({ fileName: 'bank letter.txt', size: 5, by: { name: 'Muhammad Salman' } });
    const resp = await request(x.w.app)
      .post(`/api/points/${point.id}/act`)
      .set('Cookie', x.preparer)
      .send({
        kind: 'response',
        text: 'Corrected in v2; see the bank letter',
        attachments: [
          { type: 'version', slot: 'cy', versionId: revised.body.version.id, version: 2, fileName: 'draft v2.pdf' },
          { type: 'evidence', id: ev.body.evidence.id, fileName: 'bank letter.txt', size: 5 }
        ]
      });
    expect(resp.body.point.status).toBe('responded');
    // the Reviewer who raised it (via the analysis) reopens with a reason, then the Preparer responds, then the Reviewer clears
    expect((await request(x.w.app).post(`/api/points/${point.id}/act`).set('Cookie', x.preparer).send({ kind: 'clear' })).status).toBe(403);
    expect(
      (await request(x.w.app).post(`/api/points/${point.id}/act`).set('Cookie', x.reviewer).send({ kind: 'reopen' })).body.error.message
    ).toBe('Give the reason for reopening the point.');
    expect(
      (
        await request(x.w.app)
          .post(`/api/points/${point.id}/act`)
          .set('Cookie', x.reviewer)
          .send({ kind: 'reopen', text: 'Still £10k out' })
      ).body.point.status
    ).toBe('reopened');
    expect(
      (await request(x.w.app).post(`/api/points/${point.id}/act`).set('Cookie', x.preparer).send({ kind: 'response', text: 'Now agreed' }))
        .body.point.status
    ).toBe('responded');
    const cleared = await request(x.w.app)
      .post(`/api/points/${point.id}/act`)
      .set('Cookie', x.reviewer)
      .send({ kind: 'clear', text: 'Agreed' });
    expect(cleared.body.point).toMatchObject({ status: 'cleared', clearedBy: { name: 'Rahat Kalim' } });
    const snap = await request(x.w.app).get(`/api/engagements/${x.eng.id}/review`).set('Cookie', x.reviewer);
    expect(snap.body.messages.map((m: { kind: string }) => m.kind)).toEqual(['raise', 'assign', 'response', 'reopen', 'response', 'clear']);
    expect(snap.body.messages[2].attachments).toHaveLength(2);
    const dl = await request(x.w.app).get(`/api/evidence/${ev.body.evidence.id}/file`).set('Cookie', x.reviewer);
    expect(dl.status).toBe(200);
    expect(Buffer.from(dl.body as Buffer).toString()).toBe('hello');
    expect(
      (await request(x.w.app).post(`/api/points/${point.id}/act`).set('Cookie', x.reviewer).send({ kind: 'clear' })).body.error.message
    ).toBe('A cleared point cannot be cleared.');
  });

  it('a Manager may clear any point; a different Reviewer may not clear one they did not raise', async () => {
    const x = await world();
    await ready(x);
    await analysed(x);
    const point = [...x.w.points.rows.values()][0]!;
    await request(x.w.app)
      .post(`/api/users`)
      .set('Cookie', x.admin)
      .send({ name: 'Other Reviewer', username: 'other.reviewer', password: PW, role: 'Reviewer' });
    const other = cookieOf(await request(x.w.app).post('/api/auth/login').send({ username: 'other.reviewer', password: PW }));
    await request(x.w.app).post(`/api/points/${point.id}/act`).set('Cookie', x.preparer).send({ kind: 'response', text: 'Done' });
    expect((await request(x.w.app).post(`/api/points/${point.id}/act`).set('Cookie', other).send({ kind: 'clear' })).status).toBe(403);
    expect(
      (await request(x.w.app).post(`/api/points/${point.id}/act`).set('Cookie', x.manager).send({ kind: 'clear' })).body.point.status
    ).toBe('cleared');
  });

  it('due dates and types are noted in the thread; a manual point from the tray gets the next reference', async () => {
    const x = await world();
    await ready(x);
    await analysed(x);
    const point = [...x.w.points.rows.values()][0]!;
    const meta = await request(x.w.app)
      .put(`/api/points/${point.id}/meta`)
      .set('Cookie', x.reviewer)
      .send({ type: 'explain', dueDate: '2026-10-01' });
    expect(meta.body.point).toMatchObject({ type: 'explain', dueDate: '2026-10-01' });
    expect((await request(x.w.app).put(`/api/points/${point.id}/meta`).set('Cookie', x.reviewer).send({ dueDate: 'soon' })).status).toBe(
      400
    );
    // an assignee must be a real, active member of the team; the name comes from the account
    const nobody = await request(x.w.app)
      .post(`/api/engagements/${x.eng.id}/points`)
      .set('Cookie', x.reviewer)
      .send({ content: { title: 'Receivable vs custodian' }, assignee: preparerPerson });
    expect(nobody.body.error.message).toBe('Assign the point to an active member of the review team.');
    const prep = (await x.w.users.findByUsername('muhammad.salman'))!;
    const manual = await request(x.w.app)
      .post(`/api/engagements/${x.eng.id}/points`)
      .set('Cookie', x.reviewer)
      .send({
        content: { ref: 'RP-01', title: 'Receivable vs custodian', area: 'Tie-out' },
        assignee: { id: prep.id, name: 'Someone Else', role: 'Preparer' }
      });
    expect(manual.body.point).toMatchObject({ ref: 'RP-02', source: 'manual', status: 'open', assignedTo: { name: 'Muhammad Salman' } });
    const disclosure = await request(x.w.app)
      .post(`/api/engagements/${x.eng.id}/points`)
      .set('Cookie', x.reviewer)
      .send({ content: { ref: 'RP-D1', title: 'Disclosure missing: going concern', area: 'Disclosures' } });
    expect(disclosure.body.point.ref).toBe('RP-D1');
    const snap = await request(x.w.app).get(`/api/engagements/${x.eng.id}/review`).set('Cookie', x.reviewer);
    expect(
      snap.body.messages.find((m: { text: string }) => /Type set to Needs an explanation\. Due date set to 2026-10-01\./.test(m.text))
    ).toBeTruthy();
  });
});

describe('checklist answers (UAT F1)', () => {
  it('copies the items on the first answer and records each answer with who and when', async () => {
    const x = await world();
    const items = [
      { id: 'i1', ref: '3.3', section: 'Basis', text: 'Compliance statement', keywords: [] },
      { id: 'i2', ref: '32.10', section: 'Events', text: 'Subsequent events', keywords: [] }
    ];
    const first = await request(x.w.app)
      .put(`/api/engagements/${x.eng.id}/checklist/answers/i1`)
      .set('Cookie', x.reviewer)
      .send({ framework: 'FRS 102', version: 'v1', items, answer: 'yes', ref: 'Note 1' });
    expect(first.status).toBe(200);
    expect(first.body.checklist).toMatchObject({
      framework: 'FRS 102',
      version: 'v1',
      answers: { i1: { answer: 'yes', ref: 'Note 1', by: { name: 'Rahat Kalim' } } }
    });
    expect(
      (
        await request(x.w.app)
          .put(`/api/engagements/${x.eng.id}/checklist/answers/i9`)
          .set('Cookie', x.reviewer)
          .send({ framework: 'FRS 102', answer: 'no' })
      ).status
    ).toBe(400);
    const second = await request(x.w.app)
      .put(`/api/engagements/${x.eng.id}/checklist/answers/i2`)
      .set('Cookie', x.reviewer)
      .send({ framework: 'FRS 102', answer: 'no' });
    expect(Object.keys(second.body.checklist.answers)).toEqual(['i1', 'i2']);
    expect(
      (
        await request(x.w.app)
          .put(`/api/engagements/${x.eng.id}/checklist/answers/i1`)
          .set('Cookie', x.preparer)
          .send({ framework: 'FRS 102', answer: 'yes' })
      ).status
    ).toBe(403);
  });
});

describe('sign-off (UAT G1 to G4) and billing', () => {
  it('blocked until the documents are ready, the analysis ran and every point is cleared', async () => {
    const x = await world();
    const signoff = (cookie: string, body: object) =>
      request(x.w.app).post(`/api/engagements/${x.eng.id}/signoff`).set('Cookie', cookie).send(body);
    expect((await signoff(x.manager, { state: 'signed', text: 'ok' })).body.error.message).toBe(
      'The documents are not marked ready for review.'
    );
    await ready(x);
    expect((await signoff(x.manager, { state: 'signed', text: 'ok' })).body.error.message).toBe('The analysis has not been run.');
    await analysed(x);
    expect((await signoff(x.manager, { state: 'signed', text: 'ok' })).body.error.message).toBe('1 review point is not cleared: RP-01.');
    expect((await signoff(x.reviewer, { state: 'signed', text: 'ok' })).status).toBe(403);
    const point = [...x.w.points.rows.values()][0]!;
    await request(x.w.app).post(`/api/points/${point.id}/act`).set('Cookie', x.preparer).send({ kind: 'response', text: 'Done' });
    await request(x.w.app).post(`/api/points/${point.id}/act`).set('Cookie', x.manager).send({ kind: 'clear' });
    // return and resubmit first (G2)
    expect((await signoff(x.manager, { state: 'returned' })).body.error.message).toBe('Give the reason for returning the review.');
    expect((await signoff(x.manager, { state: 'returned', text: 'Check note 7' })).body.signoff.state).toBe('returned');
    expect((await signoff(x.preparer, { state: 'resubmitted' })).status).toBe(403);
    expect((await signoff(x.reviewer, { state: 'resubmitted', text: 'Note 7 fixed' })).body.signoff.state).toBe('resubmitted');
    // the Manager signs off; this client needs no Partner; Finance is told
    const signed = await signoff(x.manager, { state: 'signed', text: 'Reviewed and agreed', summary: { blockers: [] } });
    expect(signed.status).toBe(200);
    expect(signed.body.signoff).toMatchObject({ state: 'signed', by: { name: 'Ali Awan' }, text: 'Reviewed and agreed' });
    expect(signed.body.signoff.history.map((h: { state: string }) => h.state)).toEqual(['returned', 'resubmitted', 'signed']);
    const billing = await request(x.w.app).get('/api/billing').set('Cookie', x.finance);
    expect(billing.body.state.events[x.eng.id]).toMatchObject({
      state: 'signed',
      fundName: 'ABC Fund',
      clientName: 'ABC Asset Management',
      billingEmail: 'accounts@abc.test',
      signedBy: 'Ali Awan',
      yearEndLabel: '31 December 2026'
    });
    expect(x.w.log.entries.at(-1)).toMatchObject({ category: 'Billing', summary: 'Signed off ABC Fund: ready to invoice' });
    // locked: no document change; the report can still be filed; unlock needs a reason and tells Finance
    expect(
      (
        await request(x.w.app)
          .post(`/api/engagements/${x.eng.id}/documents/sample`)
          .set('Cookie', x.preparer)
          .send({ slot: 'cy', name: 'Draft' })
      ).status
    ).toBe(423);
    const report = await request(x.w.app)
      .post(`/api/engagements/${x.eng.id}/reports`)
      .set('Cookie', x.manager)
      .attach('file', PDF, 'report.pdf');
    expect(report.status).toBe(200);
    expect(report.body.report).toMatchObject({ version: 1, signedBy: { name: 'Ali Awan' }, signedAt: signed.body.signoff.at });
    expect(
      (await request(x.w.app).post(`/api/engagements/${x.eng.id}/reports`).set('Cookie', x.preparer).attach('file', PDF, 'report.pdf'))
        .status
    ).toBe(403);
    const dl = await request(x.w.app)
      .get(`/api/reports/${report.body.report.id}/file`)
      .set('Cookie', x.reviewer)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(dl.headers['content-type']).toBe('application/pdf');
    expect(Buffer.compare(dl.body as Buffer, PDF)).toBe(0);
    expect((await signoff(x.manager, { state: 'unlocked' })).body.error.message).toBe('Give the reason for unlocking the review.');
    const unlocked = await signoff(x.manager, { state: 'unlocked', text: 'Late adjustment' });
    expect(unlocked.body.signoff.state).toBe('unlocked');
    expect((await request(x.w.app).get('/api/billing').set('Cookie', x.finance)).body.state.events[x.eng.id].state).toBe('unlocked');
    expect(
      (
        await request(x.w.app)
          .post(`/api/engagements/${x.eng.id}/documents/sample`)
          .set('Cookie', x.preparer)
          .send({ slot: 'sup', name: 'Minutes' })
      ).status
    ).toBe(400); // documents are still marked ready
  });

  it('Manager then Partner where the client requires partner sign-off (G3)', async () => {
    const x = await world({ partnerSignoff: true });
    await ready(x);
    await analysed(x, []);
    const signoff = (cookie: string, body: object) =>
      request(x.w.app).post(`/api/engagements/${x.eng.id}/signoff`).set('Cookie', cookie).send(body);
    expect((await signoff(x.manager, { state: 'signed', text: 'ok' })).body.error.message).toBe(
      'The Manager signs off first; the Partner then gives the final sign-off.'
    );
    expect((await signoff(x.partner, { state: 'manager-signed', text: 'ok' })).status).toBe(403);
    const mgr = await signoff(x.manager, { state: 'manager-signed', text: 'Agreed, over to the partner' });
    expect(mgr.body.signoff.state).toBe('manager-signed');
    expect((await request(x.w.app).get('/api/billing').set('Cookie', x.finance)).body.state.events[x.eng.id]).toBeUndefined(); // not final yet
    expect(
      (
        await request(x.w.app)
          .post(`/api/engagements/${x.eng.id}/documents/sample`)
          .set('Cookie', x.preparer)
          .send({ slot: 'sup', name: 'Minutes' })
      ).status
    ).toBe(423);
    expect((await signoff(x.manager, { state: 'signed', text: 'ok' })).status).toBe(403);
    const final = await signoff(x.partner, { state: 'signed', text: 'Partner agreed' });
    expect(final.body.signoff).toMatchObject({ state: 'signed', by: { name: 'Owais Ahmed' } });
    expect((await request(x.w.app).get('/api/billing').set('Cookie', x.finance)).body.state.events[x.eng.id]).toMatchObject({
      state: 'signed',
      signedBy: 'Owais Ahmed'
    });
    // the Partner may also return it
    const x2 = await world({ partnerSignoff: true });
    await ready(x2);
    await analysed(x2, []);
    await request(x2.w.app)
      .post(`/api/engagements/${x2.eng.id}/signoff`)
      .set('Cookie', x2.manager)
      .send({ state: 'manager-signed', text: 'ok' });
    const back = await request(x2.w.app)
      .post(`/api/engagements/${x2.eng.id}/signoff`)
      .set('Cookie', x2.partner)
      .send({ state: 'returned', text: 'Not yet' });
    expect(back.body.signoff.state).toBe('returned');
  });
});
