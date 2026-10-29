import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { actorOf } from '../../src/domain/identity/User.js';
import { buildTestWorld, cookieOf, type TestWorld } from '../helpers/fakes.js';

const PW = 'longenough1';
const PDF = Buffer.from('%PDF-1.4 test').toString('base64'); // starts with JVBERi0

async function world(opts: { aiConfigured?: boolean } = {}) {
  const w = buildTestWorld(opts);
  const admin = cookieOf(
    await request(w.app).post('/api/auth/setup').send({ name: 'Hamza Mehmood', username: 'hamza.mehmood', password: PW })
  );
  await request(w.app)
    .post('/api/users')
    .set('Cookie', admin)
    .send({ name: 'Rahat Kalim', username: 'rahat.kalim', password: PW, role: 'Reviewer' });
  const reviewer = cookieOf(await request(w.app).post('/api/auth/login').send({ username: 'rahat.kalim', password: PW }));
  return { w, admin, reviewer };
}

describe('AI settings (UAT A5)', () => {
  it('AI is off until an Administrator confirms the policy; the change and the test are logged', async () => {
    const { w, admin } = await world();
    const before = await request(w.app).get('/api/ai/settings').set('Cookie', admin);
    expect(before.body).toMatchObject({
      settings: { enabled: false, model: 'claude-sonnet-5-5' },
      key: { configured: true, last4: 'k3y1' }
    });
    const refused = await request(w.app)
      .put('/api/ai/settings')
      .set('Cookie', admin)
      .send({ settings: { enabled: true } });
    expect(refused.status).toBe(400);
    expect(refused.body.error.message).toBe('Confirm the firm’s AI policy before turning AI on.');
    const on = await request(w.app)
      .put('/api/ai/settings')
      .set('Cookie', admin)
      .send({
        settings: {
          enabled: true,
          acknowledgement: { by: { id: 'a', name: 'Hamza' }, at: '2026-10-28T10:00:00Z' },
          model: 'claude-opus-5-5',
          steps: { narrative: false }
        }
      });
    expect(on.body.settings).toMatchObject({ enabled: true, model: 'claude-opus-5-5', steps: { extract: true, narrative: false } });
    const test = await request(w.app).post('/api/ai/test').set('Cookie', admin);
    expect(test.body).toEqual({ ok: true, model: 'claude-opus-5-5', ms: 12 });
    expect(w.log.entries.slice(-2).map((e) => [e.summary, e.details])).toEqual([
      ['Changed the AI settings', 'AI turned on · model claude-opus-5-5 · Narrative review off'],
      ['Tested the AI connection', 'claude-opus-5-5 · 12 ms']
    ]);
  });

  it('non-Administrators see status but not settings', async () => {
    const { w, reviewer } = await world();
    expect((await request(w.app).get('/api/ai/status').set('Cookie', reviewer)).body).toMatchObject({ serverKey: true, enabled: false });
    expect((await request(w.app).get('/api/ai/settings').set('Cookie', reviewer)).status).toBe(403);
  });

  it('reports a clear error when no key is configured', async () => {
    const { w, admin } = await world({ aiConfigured: false });
    const test = await request(w.app).post('/api/ai/test').set('Cookie', admin);
    expect(test.status).toBe(400);
    expect(test.body.error.message).toBe('No Claude API key is configured on the server.');
  });
});

describe('Claude steps (RunAiStep, run by the analysis job)', () => {
  const file = { fileName: 'draft.pdf', mediaType: 'application/pdf', data: PDF };
  const ctx = { engagementId: 'eng-1', fundName: 'ABC Fund', aiAllowed: true, currency: 'GBP' };
  const as = async (w: TestWorld, username: string) => actorOf((await w.users.findByUsername(username))!);
  const turnOn = (w: TestWorld, admin: string) =>
    request(w.app)
      .put('/api/ai/settings')
      .set('Cookie', admin)
      .send({ settings: { enabled: true, acknowledgement: { by: { id: 'a', name: 'Hamza' }, at: '2026-10-28T10:00:00Z' } } });

  it('the browser can no longer call Claude directly; the analysis job is the only caller', async () => {
    const { w, reviewer } = await world();
    for (const path of ['/api/extract', '/api/narrative-review', '/api/explain-variances', '/api/version-pass'])
      expect((await request(w.app).post(path).set('Cookie', reviewer).send({})).status).toBe(404);
  });

  it('refuses while AI is off, then runs and logs tokens once an Administrator turns it on', async () => {
    const { w, admin } = await world();
    const reviewer = await as(w, 'rahat.kalim');
    const matrix = await w.permissions.get();
    await expect(w.uc.runAiStep.execute(reviewer, matrix, { step: 'extract', slot: 'cy', file }, ctx)).rejects.toMatchObject({
      code: 'AI_UNAVAILABLE',
      message: 'AI is turned off. An Administrator can turn it on under AI Settings.',
      details: { aiOff: true }
    });
    await turnOn(w, admin);
    w.ai.answer = { title: 'Draft', blocks: [], figures: { statedNA: 1 } };
    const out = (await w.uc.runAiStep.execute(reviewer, matrix, { step: 'extract', slot: 'cy', file }, ctx)) as {
      figures: { statedNA: number };
    };
    expect(out.figures.statedNA).toBe(1);
    expect(w.ai.calls[0]?.tool.name).toBe('record_document');
    expect(w.ai.calls[0]?.content[0]?.type).toBe('document');
    expect(w.log.entries.at(-1)).toMatchObject({
      category: 'AI',
      summary: 'AI: Reading real documents',
      engagementId: 'eng-1',
      fundName: 'ABC Fund',
      usage: { step: 'extract', model: 'claude-sonnet-5-5', input: 1000, output: 100 }
    });
  });

  it('refuses a client that does not permit AI, a wrong file type, and a role without analysis.run', async () => {
    const { w, admin } = await world();
    await turnOn(w, admin);
    const reviewer = await as(w, 'rahat.kalim');
    const matrix = await w.permissions.get();
    await expect(
      w.uc.runAiStep.execute(reviewer, matrix, { step: 'extract', slot: 'cy', file }, { ...ctx, aiAllowed: false })
    ).rejects.toThrow('AI is not permitted for this client.');
    await expect(w.uc.runAiStep.execute(reviewer, matrix, { step: 'extract', slot: 'tb', file }, ctx)).rejects.toThrow(/must be Excel/);
    await expect(
      w.uc.runAiStep.execute(await as(w, 'hamza.mehmood'), matrix, { step: 'extract', slot: 'cy', file }, ctx)
    ).resolves.toBeTruthy(); // Administrators may run everything
    await request(w.app)
      .post('/api/users')
      .set('Cookie', admin)
      .send({ name: 'Ibrahim Moola', username: 'ibrahim.moola', password: PW, role: 'Finance' });
    await expect(
      w.uc.runAiStep.execute(await as(w, 'ibrahim.moola'), matrix, { step: 'extract', slot: 'cy', file }, ctx)
    ).rejects.toMatchObject({
      code: 'FORBIDDEN'
    });
  });

  it('narrative review passes the firm rules and threshold through to the prompt', async () => {
    const { w, admin } = await world();
    await turnOn(w, admin);
    w.ai.answer = { points: [] };
    await w.uc.runAiStep.execute(
      await as(w, 'rahat.kalim'),
      await w.permissions.get(),
      {
        step: 'narrative',
        docs: { cy: {}, py: {}, is: {} },
        threshold: 250000,
        highMultiple: 4,
        customChecks: [{ id: 'CHK-15', name: 'Directors', instruction: 'Check the directors list' }]
      },
      { ...ctx, currency: 'EUR' }
    );
    const text = w.ai.calls[0]!.content.map((b) => ('text' in b ? b.text : '')).join('\n');
    expect(text).toContain('1000000 in amount');
    expect(text).toContain('<rule id="CHK-15"');
    expect(w.ai.calls[0]!.system).toContain('Amounts are in EUR');
  });
});

describe('OCR', () => {
  it('reads pages for a role that may attach documents and logs it without AI', async () => {
    const { w, reviewer } = await world();
    const res = await request(w.app)
      .post('/api/ocr')
      .set('Cookie', reviewer)
      .send({ pages: [{ png: Buffer.from('img').toString('base64') }], fileName: 'scan.pdf', _ctx: { engagementId: 'eng-1' } });
    expect(res.status).toBe(200);
    expect(res.body.pages[0].confidence).toBe(95);
    expect(w.log.entries.at(-1)).toMatchObject({ category: 'Documents', summary: 'Read 1 scanned page with OCR', engagementId: 'eng-1' });
    expect((await request(w.app).post('/api/ocr').set('Cookie', reviewer).send({ pages: [] })).status).toBe(400);
  });
});
