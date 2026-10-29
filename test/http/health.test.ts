import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { buildTestWorld } from '../helpers/fakes.js';

describe('GET /api/health', () => {
  it('answers ok with the database skipped when none is configured', async () => {
    const { app } = buildTestWorld();
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.checks.database).toBe('skipped');
    expect(res.body.version).toBe('0.1.0-test');
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('echoes a well-formed incoming X-Request-Id', async () => {
    const { app } = buildTestWorld();
    const res = await request(app).get('/api/health').set('X-Request-Id', 'req-12345678');
    expect(res.headers['x-request-id']).toBe('req-12345678');
  });
});

describe('error shape', () => {
  it('returns the standard body for an unknown route', async () => {
    const { app } = buildTestWorld();
    const res = await request(app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: 'GET /nope is not a route.' } });
  });

  it('serves the OpenAPI document with every Phase 1 route', async () => {
    const { app } = buildTestWorld();
    const res = await request(app).get('/api/docs/openapi.json');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe('3.1.0');
    for (const p of [
      '/api/health',
      '/api/auth/login',
      '/api/users/{id}',
      '/api/permissions',
      '/api/activity',
      '/api/ai/settings',
      '/api/engagements/{id}/analysis-jobs',
      '/api/ocr',
      '/api/billing',
      '/api/xero/invoice'
    ])
      expect(res.body.paths[p], p).toBeDefined();
  });
});
