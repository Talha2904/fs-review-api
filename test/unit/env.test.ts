import { describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/config/env.js';

const minimal = { NODE_ENV: 'development', DATABASE_URL: 'postgresql://u:p@localhost:5432/db', APP_URL: 'http://localhost:5173' };

describe('loadEnv', () => {
  it('fills defaults from a minimal environment', () => {
    const env = loadEnv({ ...minimal });
    expect(env.PORT).toBe(8787);
    expect(env.NODE_ENV).toBe('development');
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:5173']);
    expect(env.EVENT_BUS).toBe('memory');
    expect(env.S3_FORCE_PATH_STYLE).toBe(false);
  });

  it('splits CORS origins and coerces numbers and booleans', () => {
    const env = loadEnv({ ...minimal, CORS_ORIGINS: 'http://a.test, https://b.test', PORT: '9000', SMTP_SECURE: 'true' });
    expect(env.CORS_ORIGINS).toEqual(['http://a.test', 'https://b.test']);
    expect(env.PORT).toBe(9000);
    expect(env.SMTP_SECURE).toBe(true);
  });

  it('refuses to start without a database url and names the field', () => {
    expect(() => loadEnv({ NODE_ENV: 'development', APP_URL: 'http://localhost:5173' })).toThrow(/DATABASE_URL/);
  });

  it('requires NODE_ENV, and https addresses in production', () => {
    const { NODE_ENV: _n, ...noEnv } = minimal;
    expect(() => loadEnv(noEnv)).toThrow(/NODE_ENV/);
    expect(() => loadEnv({ ...minimal, NODE_ENV: 'production' })).toThrow(/APP_URL must use https/);
    const prod = loadEnv({
      ...minimal,
      NODE_ENV: 'production',
      APP_URL: 'https://review.example.com',
      CORS_ORIGINS: 'https://review.example.com',
      TRUST_PROXY: '1'
    });
    expect(prod.TRUST_PROXY).toBe(1);
    expect(prod.DOCS_PUBLIC).toBe(false);
  });

  it('treats blank values as unset, as a copied .env.example has', () => {
    const env = loadEnv({ ...minimal, XERO_REDIRECT_URI: '', SMTP_HOST: '  ', ANTHROPIC_API_KEY: '' });
    expect(env.XERO_REDIRECT_URI).toBeUndefined();
    expect(env.SMTP_HOST).toBeUndefined();
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it('requires REDIS_URL when the redis event bus is chosen', () => {
    expect(() => loadEnv({ ...minimal, EVENT_BUS: 'redis' })).toThrow(/REDIS_URL/);
  });
});
