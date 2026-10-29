// One-time import of the old file-based server's data (react-app/server/data) into Postgres.
//   npm run import:legacy -- ../react-app/server/data
// Idempotent: users already present (by username) and activity entries already present (by id) are skipped.
// Passwords keep working: the old server used the same scrypt parameters.
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

import { normalizeAi, normalizeMatrix, type AiSettings, type BillingState, type Role } from '@fs-review/shared';

import { loadEnv } from '../src/config/env.js';
import { createDb } from '../src/infrastructure/db/prisma.js';
import { PrismaActivityLog } from '../src/infrastructure/db/repositories/PrismaActivityLog.js';
import { PrismaAiSettingsRepository } from '../src/infrastructure/db/repositories/PrismaAiSettingsRepository.js';
import { PrismaBillingRepository } from '../src/infrastructure/db/repositories/PrismaBillingRepository.js';
import { PrismaPermissionRepository } from '../src/infrastructure/db/repositories/PrismaPermissionRepository.js';
import { PrismaUserRepository } from '../src/infrastructure/db/repositories/PrismaUserRepository.js';
import { PrismaXeroConnectionRepository } from '../src/infrastructure/db/repositories/PrismaXeroConnectionRepository.js';

const dir = path.resolve(process.argv[2] || '../react-app/server/data');
const read = <T>(name: string): T | null => {
  const f = path.join(dir, name);
  if (!existsSync(f)) return null;
  return JSON.parse(readFileSync(f, 'utf8')) as T;
};

interface LegacyUser {
  id: string;
  name: string;
  username: string;
  email?: string;
  role: Role;
  active: boolean;
  createdAt: string;
  lastSignInAt?: string;
  passwordChangedAt?: string;
  hash: string;
  salt: string;
}

const env = loadEnv();
const db = createDb(env.DATABASE_URL);
const now = new Date().toISOString();
const IMPORTER = 'import-legacy';

try {
  console.log(`Importing from ${dir}`);

  const users = new PrismaUserRepository(db);
  let n = 0;
  for (const u of read<LegacyUser[]>('users.json') ?? []) {
    if (await users.findByUsername(u.username)) continue;
    await users.create({
      id: u.id,
      name: u.name,
      username: u.username,
      email: (u.email || '').toLowerCase(),
      role: u.role,
      active: u.active !== false,
      passwordHash: u.hash,
      passwordSalt: u.salt,
      createdAt: u.createdAt || now,
      lastSignInAt: u.lastSignInAt || null,
      passwordChangedAt: u.passwordChangedAt || null
    });
    n++;
  }
  console.log(`users: ${n} added`);

  const perms = read<unknown>('permissions.json');
  if (perms) {
    await new PrismaPermissionRepository(db).save(normalizeMatrix(perms), IMPORTER, now);
    console.log('permissions: imported');
  }

  const ai = read<AiSettings>('ai-settings.json');
  if (ai) {
    await new PrismaAiSettingsRepository(db).save(normalizeAi(ai), IMPORTER, now);
    console.log('ai settings: imported');
  }

  const billing = read<BillingState>('billing.json');
  if (billing) {
    await new PrismaBillingRepository(db).update(() => ({ state: billing, result: undefined }), IMPORTER, now);
    console.log(`billing: imported (${billing.invoices?.length ?? 0} invoices)`);
  }

  const xero = read<{ access: string; refresh: string; expiresAt: number; tenantId: string; tenantName: string; connectedAt: string }>(
    'xero.json'
  );
  if (xero) {
    await new PrismaXeroConnectionRepository(db).save(
      {
        tokens: { access: xero.access, refresh: xero.refresh, expiresAt: xero.expiresAt },
        tenantId: xero.tenantId,
        tenantName: xero.tenantName,
        connectedAt: xero.connectedAt || now
      },
      now
    );
    console.log('xero: imported');
  }

  const logFile = path.join(dir, 'activity.jsonl');
  if (existsSync(logFile)) {
    const log = new PrismaActivityLog(db);
    const existing = new Set((await log.list({ limit: 20000 })).map((e) => e.id));
    let a = 0;
    for (const line of readFileSync(logFile, 'utf8').split('\n').filter(Boolean)) {
      let e;
      try {
        e = JSON.parse(line);
      } catch {
        continue;
      }
      if (!e?.id || existing.has(e.id)) continue;
      await log.append({
        id: e.id,
        at: e.at || now,
        actor: e.actor ? { id: e.actor.id, name: e.actor.name || '', username: e.actor.username || '', role: e.actor.role || '' } : null,
        category: e.category || '',
        summary: e.summary || '',
        details: e.details || '',
        ip: e.ip || '',
        engagementId: e.engagementId || null,
        fundName: e.fundName || null,
        ...(e.usage ? { usage: e.usage } : {})
      });
      a++;
    }
    console.log(`activity: ${a} entries added`);
  }
  console.log('Done.');
} finally {
  await db.$disconnect();
}
