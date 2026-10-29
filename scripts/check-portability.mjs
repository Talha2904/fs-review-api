// Database portability gate (plan section 11.3). Makes a MySQL copy of prisma/schema.prisma (only the provider
// changes) and proves that:
//   1. it validates as a MySQL schema (no engine-specific types or features),
//   2. Prisma can express it as MySQL DDL (written to the output folder for review),
//   3. with MYSQL_URL set, it deploys to a real MySQL server (prisma db push into an empty database).
// Run: npm run check:portability            (steps 1 and 2)
//      MYSQL_URL=mysql://root:pw@localhost:3306/fsreview npm run check:portability   (all three)
import { execFileSync } from 'node:child_process';
import console from 'node:console';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const api = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const prisma = path.join(api, 'node_modules', 'prisma', 'build', 'index.js');
const out = path.join(tmpdir(), 'fs-review-portability');
mkdirSync(out, { recursive: true });

const source = readFileSync(path.join(api, 'prisma', 'schema.prisma'), 'utf8');
if (!/provider\s*=\s*"postgresql"/.test(source)) throw new Error('Expected the postgresql provider in prisma/schema.prisma.');
// Native types other than @db.Text (valid on both engines) would tie the schema to one engine.
const native = [...source.matchAll(/@db\.(\w+)/g)].map((m) => m[1]).filter((t) => t !== 'Text');
if (native.length) throw new Error(`Engine-specific column types in the schema: ${[...new Set(native)].join(', ')}`);

const schema = path.join(out, 'schema.prisma');
writeFileSync(schema, source.replace(/provider\s*=\s*"postgresql"/, 'provider = "mysql"'));
const env = { ...process.env, DATABASE_URL: process.env.MYSQL_URL || 'mysql://check:check@localhost:3306/check' };
const run = (args) => execFileSync(process.execPath, [prisma, ...args, '--schema', schema], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

run(['validate']);
console.log('1. The schema validates as MySQL.');
const ddl = execFileSync(process.execPath, [prisma, 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', schema, '--script'], { env, encoding: 'utf8' });
writeFileSync(path.join(out, 'mysql.sql'), ddl);
console.log(`2. MySQL DDL: ${ddl.match(/CREATE TABLE/g)?.length ?? 0} tables, written to ${path.join(out, 'mysql.sql')}`);
if (process.env.MYSQL_URL) {
  run(['db', 'push', '--skip-generate', '--accept-data-loss']);
  console.log('3. The schema deploys to the MySQL server at MYSQL_URL.');
} else console.log('3. Skipped: set MYSQL_URL to deploy the schema to a MySQL server.');
