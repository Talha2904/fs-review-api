import { createHash, randomBytes } from 'node:crypto';

import type { Tokens } from '../../application/ports/Tokens.js';

export class CryptoTokens implements Tokens {
  secret(): string {
    return randomBytes(32).toString('hex');
  }
  fingerprint(secret: string): string {
    return createHash('sha256').update(String(secret)).digest('hex');
  }
  fingerprintBytes(bytes: Uint8Array): string {
    return createHash('sha256').update(bytes).digest('hex');
  }
}
