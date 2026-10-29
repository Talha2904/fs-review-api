// Every route the api serves is in the OpenAPI document, and every documented path is served (plan section 11,
// definition of done). Routes are read from Express's own router, so a new route without a document entry
// fails this test.
import { describe, expect, it } from 'vitest';

import { buildOpenApi } from '../../src/interface/http/openapi.js';
import { buildTestWorld } from '../helpers/fakes.js';

interface Layer {
  route?: { path: string; methods: Record<string, boolean> };
  name?: string;
  handle?: { stack?: Layer[] };
}

function served(stack: Layer[]): string[] {
  const out: string[] = [];
  for (const l of stack) {
    if (l.route)
      for (const m of Object.keys(l.route.methods)) out.push(`${m.toUpperCase()} /api${l.route.path.replace(/:(\w+)/g, '{$1}')}`);
    else if (l.name === 'router' && l.handle?.stack) out.push(...served(l.handle.stack));
  }
  return out;
}

describe('the OpenAPI document matches the routes', () => {
  it('documents every route and serves every documented path', () => {
    const { app } = buildTestWorld();
    const routes = new Set(
      served((app as unknown as { _router: { stack: Layer[] } })._router.stack).filter((r) => !r.includes('/api/docs'))
    );
    const doc = buildOpenApi('test') as unknown as { paths: Record<string, Record<string, unknown>> };
    const documented = new Set(Object.entries(doc.paths).flatMap(([p, ops]) => Object.keys(ops).map((m) => `${m.toUpperCase()} ${p}`)));
    expect([...routes].filter((r) => !documented.has(r)).sort()).toEqual([]);
    expect([...documented].filter((r) => !routes.has(r)).sort()).toEqual([]);
  });
});
