// The only file that creates a Prisma client. Repositories under infrastructure/db receive it.
// Nothing outside infrastructure/db may import @prisma/client (enforced by eslint.config.js).
import { PrismaClient } from '@prisma/client';

export type Db = PrismaClient;

export function createDb(databaseUrl: string): Db {
  return new PrismaClient({ datasources: { db: { url: databaseUrl } }, log: ['warn', 'error'] });
}

/** True when the database answers. Uses the one SQL statement every engine understands. */
export async function pingDb(db: Db): Promise<boolean> {
  try {
    await db.$queryRawUnsafe('SELECT 1');
    return true;
  } catch {
    return false;
  }
}
