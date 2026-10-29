import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { buildTestWorld, cookieOf, type TestWorld } from '../helpers/fakes.js';

const PW = 'longenough1';
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n');
const PDF2 = Buffer.from('%PDF-1.4\n2 0 obj << /Type /Catalog >> endobj\n%%EOF\n');
const XLSX = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x08, 0x00]);

async function world() {
  const w = buildTestWorld();
  const admin = cookieOf(
    await request(w.app).post('/api/auth/setup').send({ name: 'Hamza Mehmood', username: 'hamza.mehmood', password: PW })
  );
  for (const [name, username, role] of [
    ['Ali Awan', 'ali.awan', 'Manager'],
    ['Rahat Kalim', 'rahat.kalim', 'Reviewer'],
    ['Muhammad Salman', 'muhammad.salman', 'Preparer'],
    ['Ibrahim Moola', 'ibrahim.moola', 'Finance']
  ])
    await request(w.app).post('/api/users').set('Cookie', admin).send({ name, username, password: PW, role });
  const as = async (u: string) => cookieOf(await request(w.app).post('/api/auth/login').send({ username: u, password: PW }));
  const manager = await as('ali.awan');
  const ent = (
    await request(w.app)
      .post('/api/entities')
      .set('Cookie', manager)
      .send({
        name: 'ABC Funds ICAV',
        framework: 'FRS 102',
        aiPermitted: true,
        aiBasis: 'Letter',
        aiDecidedBy: { id: 'm', name: 'Ali' },
        aiDecidedAt: '2026-10-28T10:00:00.000Z'
      })
  ).body.entity;
  const eng = (
    await request(w.app)
      .post('/api/engagements')
      .set('Cookie', manager)
      .send({ entityId: ent.id, fund: { name: 'ABC Fund', yearEnd: '2026-12-31', currency: 'GBP' } })
  ).body.engagement;
  return {
    w,
    admin,
    manager,
    reviewer: await as('rahat.kalim'),
    preparer: await as('muhammad.salman'),
    finance: await as('ibrahim.moola'),
    eng
  };
}

const upload = (w: TestWorld, cookie: string, engId: string, slot: string, name: string, bytes: Buffer) =>
  request(w.app).post(`/api/engagements/${engId}/documents`).set('Cookie', cookie).field('slot', slot).attach('file', bytes, name);

describe('documents (UAT C1 to C4)', () => {
  it('C1: a PDF in the Trial Balance slot is refused with the reason', async () => {
    const { w, preparer, eng } = await world();
    const res = await upload(w, preparer, eng.id, 'tb', 'draft.pdf', PDF);
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe('This document must be Excel (.xlsx); “draft.pdf” is not.');
    const fake = await upload(w, preparer, eng.id, 'cy', 'draft.pdf', Buffer.from('hello'));
    expect(fake.body.error.message).toBe('“draft.pdf” is not a PDF.');
  });

  it('C2: the Preparer attaches documents; each is v1, stored, and the snapshot shows it as current', async () => {
    const { w, preparer, eng } = await world();
    const a = await upload(w, preparer, eng.id, 'cy', 'ABC draft.pdf', PDF);
    expect(a.status).toBe(200);
    expect(a.body).toMatchObject({
      unchanged: false,
      version: { slot: 'cy', version: 1, fileName: 'ABC draft.pdf', size: PDF.length, sample: false, validation: { status: 'checking' } }
    });
    expect(a.body.version.storageKey).toBeUndefined();
    expect(a.body.version.uploadedBy).toMatchObject({ name: 'Muhammad Salman', role: 'Preparer' });
    expect(w.storage.files.size).toBe(1);
    const tb = await upload(w, preparer, eng.id, 'tb', 'ABC TB.xlsx', XLSX);
    expect(tb.status).toBe(200);
    const snap = await request(w.app).get(`/api/engagements/${eng.id}/review`).set('Cookie', preparer);
    expect(Object.keys(snap.body.current).sort()).toEqual(['cy', 'tb']);
    expect(snap.body.versions).toHaveLength(2);
    expect(snap.body.workflow.state).toBe('preparing');
    expect(snap.body.signoff.state).toBe('none');
    // the web app's recognition result is stored against the version
    const val = await request(w.app)
      .put(`/api/documents/${a.body.version.id}/validation`)
      .set('Cookie', preparer)
      .send({ validation: { status: 'recognised', summary: 'Recognised: draft financial statements', checks: [], localReadable: true } });
    expect(val.body.version.validation).toMatchObject({ status: 'recognised', localReadable: true, checkedAt: '2026-10-28T10:00:00.000Z' });
  });

  it('C4: the same content under a new name makes no new version; older content restored is marked same as vN', async () => {
    const { w, preparer, eng } = await world();
    const v1 = await upload(w, preparer, eng.id, 'cy', 'draft.pdf', PDF);
    const same = await upload(w, preparer, eng.id, 'cy', 'draft-renamed.pdf', PDF);
    expect(same.body.unchanged).toBe(true);
    expect(same.body.version.id).toBe(v1.body.version.id);
    const v2 = await upload(w, preparer, eng.id, 'cy', 'draft v2.pdf', PDF2);
    expect(v2.body.version.version).toBe(2);
    const v3 = await upload(w, preparer, eng.id, 'cy', 'draft again.pdf', PDF);
    expect(v3.body.version).toMatchObject({ version: 3, sameAs: 1 });
    expect(w.storage.files.size).toBe(2); // the restored content was not stored twice
  });

  it('C3: a mismatch can be confirmed only with a reason; replacing the file fixes it; a removed slot is empty again', async () => {
    const { w, preparer, eng } = await world();
    const tb = await upload(w, preparer, eng.id, 'tb', 'XYZ TB.xlsx', XLSX);
    await request(w.app)
      .put(`/api/documents/${tb.body.version.id}/validation`)
      .set('Cookie', preparer)
      .send({ validation: { status: 'mismatch', summary: 'Mismatch: another fund', checks: [] } });
    const noReason = await request(w.app).post(`/api/documents/${tb.body.version.id}/confirm`).set('Cookie', preparer).send({});
    expect(noReason.body.error.message).toBe('Give the reason for confirming a mismatched document.');
    const ok = await request(w.app)
      .post(`/api/documents/${tb.body.version.id}/confirm`)
      .set('Cookie', preparer)
      .send({ reason: 'Checked with the administrator' });
    expect(ok.body.version.confirmation).toMatchObject({ by: { name: 'Muhammad Salman' }, reason: 'Checked with the administrator' });
    const replaced = await upload(w, preparer, eng.id, 'tb', 'ABC TB.xlsx', Buffer.concat([XLSX, Buffer.from('abc')]));
    expect(replaced.body.version.version).toBe(2);
    await request(w.app).delete(`/api/engagements/${eng.id}/documents/tb`).set('Cookie', preparer);
    const snap = await request(w.app).get(`/api/engagements/${eng.id}/review`).set('Cookie', preparer);
    expect(snap.body.current.tb).toBeUndefined();
    expect(snap.body.versions.filter((v: { slot: string }) => v.slot === 'tb')).toHaveLength(2);
  });

  it('downloads the stored file for any staff member and refuses Finance', async () => {
    const { w, preparer, reviewer, finance, eng } = await world();
    const a = await upload(w, preparer, eng.id, 'cy', 'draft.pdf', PDF);
    const dl = await request(w.app)
      .get(`/api/documents/${a.body.version.id}/file`)
      .set('Cookie', reviewer)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(dl.status).toBe(200);
    expect(dl.headers['content-type']).toBe('application/pdf');
    expect(Buffer.compare(dl.body as Buffer, PDF)).toBe(0);
    // Finance is a staff member for reads of the snapshot but may not attach
    expect((await upload(w, finance, eng.id, 'cy', 'x.pdf', PDF)).status).toBe(403);
  });
});

describe('workflow (UAT C5) and the lock rule', () => {
  async function attachAll(w: TestWorld, cookie: string, engId: string) {
    for (const [slot, name] of [
      ['cy', 'Draft'],
      ['py', 'Signed'],
      ['tb', 'TB'],
      ['is', 'Schedule']
    ])
      await request(w.app).post(`/api/engagements/${engId}/documents/sample`).set('Cookie', cookie).send({ slot, name });
  }

  it('Mark Ready needs every required document cleared; then Send Back unlocks with a reason', async () => {
    const { w, preparer, reviewer, eng } = await world();
    const early = await request(w.app).put(`/api/engagements/${eng.id}/workflow`).set('Cookie', preparer).send({ state: 'ready' });
    expect(early.body.error.message).toBe('Attach every required document before marking them ready.');
    await attachAll(w, preparer, eng.id);
    const real = await upload(w, preparer, eng.id, 'cy', 'draft.pdf', PDF); // still "checking", so not cleared
    const unclear = await request(w.app).put(`/api/engagements/${eng.id}/workflow`).set('Cookie', preparer).send({ state: 'ready' });
    expect(unclear.body.error.message).toBe('Every document must be recognised or confirmed before marking them ready.');
    await request(w.app)
      .put(`/api/documents/${real.body.version.id}/validation`)
      .set('Cookie', preparer)
      .send({ validation: { status: 'recognised', summary: 'ok', checks: [] } });
    const ready = await request(w.app).put(`/api/engagements/${eng.id}/workflow`).set('Cookie', preparer).send({ state: 'ready' });
    expect(ready.status).toBe(200);
    expect(ready.body.workflow).toMatchObject({ state: 'ready', by: { name: 'Muhammad Salman' } });
    // a Preparer cannot send back; a Reviewer can, with a reason
    expect(
      (await request(w.app).put(`/api/engagements/${eng.id}/workflow`).set('Cookie', preparer).send({ state: 'returned', reason: 'x' }))
        .status
    ).toBe(403);
    const noReason = await request(w.app).put(`/api/engagements/${eng.id}/workflow`).set('Cookie', reviewer).send({ state: 'returned' });
    expect(noReason.body.error.message).toBe('Give the reason for sending the documents back.');
    const back = await request(w.app)
      .put(`/api/engagements/${eng.id}/workflow`)
      .set('Cookie', reviewer)
      .send({ state: 'returned', reason: 'Wrong trial balance' });
    expect(back.body.workflow.state).toBe('returned');
    expect(back.body.workflow.history.map((h: { state: string }) => h.state)).toEqual(['ready', 'returned']);
    const again = await request(w.app).put(`/api/engagements/${eng.id}/workflow`).set('Cookie', preparer).send({ state: 'ready' });
    expect(again.status).toBe(200);
    // the permission check comes first, so a Preparer learns nothing about the state machine
    expect(
      (await request(w.app).put(`/api/engagements/${eng.id}/workflow`).set('Cookie', preparer).send({ state: 'preparing' })).status
    ).toBe(403);
    const bad = await request(w.app).put(`/api/engagements/${eng.id}/workflow`).set('Cookie', reviewer).send({ state: 'preparing' });
    expect(bad.body.error.message).toBe('The documents cannot go from ready to preparing.');
  });

  it('documents marked ready cannot be attached or removed until they are sent back', async () => {
    const { w, preparer, reviewer, eng } = await world();
    await attachAll(w, preparer, eng.id);
    await request(w.app).put(`/api/engagements/${eng.id}/workflow`).set('Cookie', preparer).send({ state: 'ready' });
    const blocked = await upload(w, preparer, eng.id, 'cy', 'draft.pdf', PDF);
    expect(blocked.status).toBe(400);
    expect(blocked.body.error.message).toBe('The documents are marked ready for review. Send them back to the preparer to change them.');
    expect((await request(w.app).delete(`/api/engagements/${eng.id}/documents/tb`).set('Cookie', preparer)).status).toBe(400);
    await request(w.app)
      .put(`/api/engagements/${eng.id}/workflow`)
      .set('Cookie', reviewer)
      .send({ state: 'returned', reason: 'Please attach the final draft' });
    expect((await upload(w, preparer, eng.id, 'cy', 'draft.pdf', PDF)).status).toBe(200);
  });

  it('a signed-off review refuses every document change with 423', async () => {
    const { w, preparer, eng } = await world();
    await w.signoffs.save({
      engagementId: eng.id,
      state: 'signed',
      by: null,
      at: '2026-10-28T12:00:00.000Z',
      text: '',
      summary: null,
      history: []
    });
    const res = await upload(w, preparer, eng.id, 'cy', 'draft.pdf', PDF);
    expect(res.status).toBe(423);
    expect(res.body.error.code).toBe('LOCKED');
    expect((await request(w.app).get(`/api/engagements/${eng.id}/review`).set('Cookie', preparer)).status).toBe(200); // reads still work
  });

  it('publishes a change event after every write and lists every fund in /api/reviews', async () => {
    const { w, preparer, eng } = await world();
    const seen: string[] = [];
    w.events.subscribe((e) => seen.push(`${e.topic}:${e.engagementId}`));
    await upload(w, preparer, eng.id, 'cy', 'draft.pdf', PDF);
    await request(w.app).post(`/api/engagements/${eng.id}/documents/sample`).set('Cookie', preparer).send({ slot: 'py', name: 'Signed' });
    expect(seen).toEqual([`document_versions:${eng.id}`, `document_versions:${eng.id}`]);
    const all = await request(w.app).get('/api/reviews').set('Cookie', preparer);
    expect(Object.keys(all.body.reviews)).toEqual([eng.id]);
    expect(Object.keys(all.body.reviews[eng.id].current).sort()).toEqual(['cy', 'py']);
  });

  it('the events stream says hello and carries changes', async () => {
    const { w, preparer, eng } = await world();
    // a real socket: supertest buffers responses, and an event stream never ends
    const server = w.app.listen(0);
    const port = (server.address() as { port: number }).port;
    try {
      const controller = new AbortController();
      const res = await fetch(`http://127.0.0.1:${port}/api/events`, { headers: { Cookie: preparer }, signal: controller.signal });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/event-stream');
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let text = '';
      const readUntil = async (marker: string) => {
        const deadline = Date.now() + 3000;
        while (!text.includes(marker) && Date.now() < deadline) {
          const next = await Promise.race([
            reader.read(),
            new Promise<{ done: true; value: undefined }>((r) =>
              setTimeout(() => r({ done: true, value: undefined }), deadline - Date.now())
            )
          ]);
          if (next.done) break;
          text += decoder.decode(next.value, { stream: true });
        }
      };
      await readUntil('event: hello'); // the subscription exists once the hello has arrived
      await upload(w, preparer, eng.id, 'cy', 'draft.pdf', PDF);
      await readUntil('event: change');
      controller.abort();
      expect(text).toContain('event: hello');
      expect(text).toContain('event: change');
      expect(text).toContain(`"engagementId":"${eng.id}"`);
    } finally {
      server.closeAllConnections(); // the event stream never ends on its own
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
