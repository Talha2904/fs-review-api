// Typed, validated configuration. Loaded once at start; the process refuses to run on a bad value.
// Nothing else in the codebase reads process.env.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

// api/.env is found relative to this file, so the api starts the same from any working directory.
// Real environment variables win over the file. In tests the file is ignored.
if (process.env.NODE_ENV !== 'test') loadDotenv({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });

const bool = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

const schema = z.object({
  // Required: a production server started without it would run with development settings (no Secure cookie).
  NODE_ENV: z.enum(['development', 'test', 'production'], { required_error: 'set NODE_ENV to development, test or production' }),
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  DATABASE_URL: z.string().url(),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .transform((s) =>
      s
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean)
    ),
  APP_URL: z.string().url(),
  /** Express trust proxy: 'loopback' (default: only a local proxy such as Vite), a hop count, or proxy addresses. */
  TRUST_PROXY: z
    .string()
    .default('loopback')
    .transform((v) => (/^\d+$/.test(v) ? Number(v) : v)),
  /** Serve the API reference at /api/docs in production too (it is always served outside production). */
  DOCS_PUBLIC: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default('eu-west-1'),
  S3_BUCKET: z.string().default('fs-review'),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: bool,

  EVENT_BUS: z.enum(['memory', 'redis']).default('memory'),
  REDIS_URL: z.string().url().optional(),

  ANTHROPIC_API_KEY: z.string().optional(),
  CLAUDE_MODEL: z.string().default('claude-sonnet-5-5'),

  /** Where Tesseract caches its language data; relative to the api folder. */
  OCR_CACHE_DIR: z.string().default('data/ocr-cache'),
  /** How many analyses this api instance runs at once; more wait in the queue. */
  ANALYSIS_WORKERS: z.coerce.number().int().min(1).max(16).default(2),
  /** Where uploaded files live when no S3 settings are given; relative to the api folder. */
  FILES_DIR: z.string().default('data/files'),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_SECURE: bool,
  MAIL_FROM: z.string().optional(),
  /** Older name for MAIL_FROM, still honoured. */
  BILLING_FROM: z.string().optional(),

  /** Daily USD to GBP rate: fetch twice a day when true; FX_URL overrides the rates service. */
  BILLING_FX_AUTO: z
    .enum(['0', '1', 'true', 'false'])
    .default('0')
    .transform((v) => v === '1' || v === 'true'),
  FX_URL: z.string().url().optional(),

  XERO_CLIENT_ID: z.string().optional(),
  XERO_CLIENT_SECRET: z.string().optional(),
  XERO_REDIRECT_URI: z.string().url().optional(),
  XERO_AUTH_URL: z.string().url().optional(),
  XERO_TOKEN_URL: z.string().url().optional(),
  XERO_API_BASE: z.string().url().optional()
});

export type Env = z.infer<typeof schema>;

/** Parses the given environment (defaults to process.env). Throws with a readable list of problems. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  // A blank line in .env (SMTP_HOST=) means "not set", not "the empty string".
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== undefined && v.trim() !== ''));
  const r = schema.safeParse(cleaned);
  if (!r.success) {
    const lines = r.error.issues.map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new Error(`Configuration is not valid:\n${lines.join('\n')}\nSee api/.env.example.`);
  }
  if (r.data.EVENT_BUS === 'redis' && !r.data.REDIS_URL)
    throw new Error('Configuration is not valid:\n  REDIS_URL is required when EVENT_BUS=redis');
  const env = r.data;
  if (env.NODE_ENV === 'production') {
    const problems = [
      ...(env.APP_URL.startsWith('https://') ? [] : ['APP_URL must use https in production']),
      ...env.CORS_ORIGINS.filter((o) => !o.startsWith('https://')).map((o) => `CORS_ORIGINS entry ${o} must use https in production`)
    ];
    if (problems.length) throw new Error(`Configuration is not valid:\n${problems.map((p) => `  ${p}`).join('\n')}`);
  }
  if (!env.MAIL_FROM && env.BILLING_FROM) env.MAIL_FROM = env.BILLING_FROM;
  return env;
}
