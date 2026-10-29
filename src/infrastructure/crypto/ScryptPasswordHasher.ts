import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

import type { PasswordHash, PasswordHasher } from '../../application/ports/PasswordHasher.js';

const scryptAsync = promisify<string, string, number, Buffer>(scrypt);

/** scrypt with a 16-byte salt and a 64-byte key, the same parameters the old server used, so existing hashes keep working. */
export class ScryptPasswordHasher implements PasswordHasher {
  async hash(password: string): Promise<PasswordHash> {
    const salt = randomBytes(16).toString('hex');
    const key = await scryptAsync(password, salt, 64);
    return { salt, hash: key.toString('hex') };
  }

  async verify(password: string, stored: PasswordHash): Promise<boolean> {
    const key = await scryptAsync(password, stored.salt, 64);
    const expected = Buffer.from(stored.hash, 'hex');
    return key.length === expected.length && timingSafeEqual(key, expected);
  }
}
