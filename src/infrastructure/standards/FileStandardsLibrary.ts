// The standards index on disk (standards/frs102.json and standards/ifrs.json, built by scripts/build-standards.ts),
// read once per framework and kept in memory. A missing file means no standards for that framework, not an error:
// the review then runs as it did before.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import type { Logger } from '../../application/ports/Logger.js';
import type { StandardPassage, StandardsFramework, StandardsLibrary } from '../../application/ports/StandardsLibrary.js';

const FILES: Record<StandardsFramework, string> = { 'FRS 102': 'frs102.json', IFRS: 'ifrs.json' };
// src/infrastructure/standards and dist/infrastructure/standards are both three levels below the api folder
const DEFAULT_DIR = fileURLToPath(new URL('../../../standards/', import.meta.url));

export class FileStandardsLibrary implements StandardsLibrary {
  private readonly cache = new Map<StandardsFramework, Promise<StandardPassage[]>>();

  constructor(
    private readonly logger?: Logger,
    private readonly dir = DEFAULT_DIR
  ) {}

  passages(framework: StandardsFramework): Promise<StandardPassage[]> {
    let p = this.cache.get(framework);
    if (!p) {
      p = readFile(this.dir + FILES[framework], 'utf8')
        .then((s) => {
          const list = JSON.parse(s) as unknown;
          const ok = (x: unknown): x is StandardPassage => {
            const r = x as Partial<Record<keyof StandardPassage, unknown>> | null;
            return !!r && ['ref', 'std', 'topic', 'text'].every((k) => typeof r[k as keyof StandardPassage] === 'string');
          };
          return Array.isArray(list) ? list.filter(ok) : [];
        })
        .catch((err: unknown) => {
          this.logger?.warn({ err, framework }, 'The standards index could not be read; the review runs without it');
          return [] as StandardPassage[];
        });
      this.cache.set(framework, p);
    }
    return p;
  }
}
