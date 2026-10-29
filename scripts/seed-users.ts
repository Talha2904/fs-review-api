// Adds the starting accounts from @fs-review/shared to the database. Run once: `npm run seed`.
// Accounts that already exist are left unchanged. They share a known password: change each after first sign-in.
import { SEED_USERS } from '@fs-review/shared';

import { loadEnv } from '../src/config/env.js';
import { ScryptPasswordHasher } from '../src/infrastructure/crypto/ScryptPasswordHasher.js';
import { createDb } from '../src/infrastructure/db/prisma.js';
import { PrismaUserRepository } from '../src/infrastructure/db/repositories/PrismaUserRepository.js';
import { UuidGenerator } from '../src/infrastructure/ids/UuidGenerator.js';

const env = loadEnv();
const db = createDb(env.DATABASE_URL);
const users = new PrismaUserRepository(db);
const hasher = new ScryptPasswordHasher();
const ids = new UuidGenerator();

try {
  const added: string[] = [];
  for (const s of SEED_USERS) {
    if (await users.findByUsername(s.username)) continue;
    const { hash, salt } = await hasher.hash(s.password);
    await users.create({
      id: ids.next(),
      name: s.name,
      username: s.username,
      email: '',
      role: s.role,
      active: true,
      passwordHash: hash,
      passwordSalt: salt,
      createdAt: new Date().toISOString(),
      lastSignInAt: null,
      passwordChangedAt: null
    });
    added.push(`${s.username} (${s.role})`);
  }
  console.log(added.length ? `Added: ${added.join(', ')}` : 'All starting accounts already exist.');
  console.log('These accounts share a known password. Change each one after first sign-in.');
} finally {
  await db.$disconnect();
}
