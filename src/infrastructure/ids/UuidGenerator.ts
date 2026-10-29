import { randomUUID } from 'node:crypto';

import type { IdGenerator } from '../../application/ports/IdGenerator.js';

export class UuidGenerator implements IdGenerator {
  next(): string {
    return randomUUID();
  }
}
