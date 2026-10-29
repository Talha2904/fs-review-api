// Runs every analysis scenario through the web app's original pipeline (the browser analysis before Phase 6,
// kept frozen in test/parity/web-engine) and through the api's port, and compares the results.
//   npm run parity:analysis                         compare, using the frozen web engine
//   npm run parity:analysis -- --web <path>         another checkout of the web app's engine
//   npm run parity:analysis -- --write              also record the web app's results as golden/*.json
// The golden files let `npm test` check the api against the browser without the web app's repository.
// Add a scenario (and its documents) to test/fixtures/analysis/scenarios.ts to check another document pack.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { normalise, SCENARIOS, cannedAi, fileBytes, sha256Of, FIXTURES, type Scenario } from '../test/fixtures/analysis/scenarios.js';
import { runServerScenario, type EngineRun } from '../test/helpers/analysisParity.js';

const args = process.argv.slice(2);
const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const web = path.resolve(
  args.includes('--web') ? (args[args.indexOf('--web') + 1] as string) : path.join(apiRoot, 'test/parity/web-engine')
);
const write = args.includes('--write');
const GOLDEN = path.join(FIXTURES, 'golden');

type Body = Record<string, unknown>;
const STEP: Record<string, 'extract' | 'narrative' | 'explain' | 'version'> = {
  '/api/extract': 'extract',
  '/api/narrative-review': 'narrative',
  '/api/explain-variances': 'explain',
  '/api/version-pass': 'version'
};

// The browser APIs the web app's pipeline touches: fetch (the four AI routes) and FileReader (payloads).
let aiCalls: string[] = [];
globalThis.fetch = (async (url: string, init?: { body?: string }) => {
  const step = STEP[String(url)];
  if (!step) throw new Error(`Unexpected request ${url}`);
  aiCalls.push(step);
  const answer = JSON.parse(JSON.stringify(cannedAi(step, JSON.parse(init?.body || '{}') as Body)));
  return { ok: true, status: 200, json: async () => answer };
}) as unknown as typeof fetch;
class NodeFileReader {
  result: string | null = null;
  onload: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  readAsDataURL(file: Blob) {
    file.arrayBuffer().then(
      (b) => {
        this.result = `data:${file.type || 'application/octet-stream'};base64,${Buffer.from(b).toString('base64')}`;
        this.onload?.();
      },
      (e) => this.onerror?.(e)
    );
  }
}
(globalThis as Record<string, unknown>).FileReader = NodeFileReader;

const mod = async <T>(rel: string): Promise<T> => (await import(pathToFileURL(path.join(web, rel)).href)) as T;

interface WebApp {
  liveAnalysis: (...a: unknown[]) => Promise<unknown>;
  demoAnalysis: (...a: unknown[]) => Promise<unknown>;
  buildLibrary: (c: unknown) => unknown[];
  defaultRulesFor: (l: unknown[]) => Record<string, unknown>;
  withDefaults: (e: unknown) => Record<string, unknown>;
  settingsSignature: (s: unknown) => string;
  withOverrides: (t: unknown, o: unknown) => Record<string, unknown>;
  effectiveRules: (e: unknown, t: unknown) => Record<string, unknown>;
  setCurrency: (c: string) => void;
}

async function loadWebApp(): Promise<WebApp> {
  if (!existsSync(path.join(web, 'src/lib/pipeline.js'))) throw new Error(`No web app at ${web}`);
  const pipeline = await mod<Record<string, unknown>>('src/lib/pipeline.js');
  if (typeof pipeline.liveAnalysis !== 'function')
    throw new Error('This web app revision no longer runs the analysis in the browser (no liveAnalysis).');
  const lib = await mod<Record<string, unknown>>('src/data/checkLibrary.js');
  const rules = await mod<Record<string, unknown>>('src/lib/ruleTemplate.js');
  const format = await mod<Record<string, unknown>>('src/lib/format.js');
  return { ...pipeline, ...lib, ...rules, ...format } as unknown as WebApp;
}

async function runWebScenario(app: WebApp, sc: Scenario, previous: unknown): Promise<EngineRun> {
  // the screens' own construction of the analysis settings (App.jsx)
  const library = app.buildLibrary(sc.config);
  const template = { ...app.defaultRulesFor(library), ...((sc.config?.rules as object) || {}) };
  const active = app.withDefaults(sc.engagement);
  const setup = { ...active, rules: app.effectiveRules(active, app.withOverrides(template, sc.entity?.ruleOverrides)) };
  app.setCurrency(String((active.fund as { currency?: string })?.currency || 'GBP'));
  const ticks: number[] = [];
  aiCalls = [];
  const tick = (n: number) => ticks.push(n);
  let result;
  if (sc.kind === 'sample') result = await app.demoAnalysis(previous ? 3 : 2, tick, setup);
  else {
    const kept = new Map<string, unknown>();
    const files: Record<string, unknown> = {};
    for (const [slot, f] of Object.entries(sc.files)) {
      const bytes = fileBytes(f);
      const sha256 = sha256Of(bytes);
      files[slot] = {
        name: f.name,
        file: bytes ? new File([bytes], f.name) : null,
        sample: !!f.sample,
        versionId: `v-${slot}`,
        sha256,
        readWith: f.readWith ?? null
      };
      if (sc.seedReadings?.includes(slot as never))
        kept.set(`${slot}:${sha256}`, JSON.parse(JSON.stringify(cannedAi('extract', { slot, file: { fileName: f.name } }))));
    }
    const readings = {
      get: (slot: string, sha: string) => kept.get(`${slot}:${sha}`) || null,
      put: async (slot: string, sha: string, r: unknown) => void kept.set(`${slot}:${sha}`, r)
    };
    result = await app.liveAnalysis(files, setup, tick, previous, library, sc.ai, readings, sc.umbrella, { ocr: false });
  }
  return { result: result as EngineRun['result'], settingsSig: app.settingsSignature(setup), ticks, aiCalls: [...aiCalls] };
}

/** Paths where two JSON values differ, at most `max` of them. */
function differences(a: unknown, b: unknown, at = '', out: string[] = [], max = 12): string[] {
  if (out.length >= max) return out;
  if (JSON.stringify(a) === JSON.stringify(b)) return out;
  if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
    for (const k of keys) differences((a as Body)[k], (b as Body)[k], `${at}.${k}`, out, max);
    return out;
  }
  out.push(`${at || '(root)'}: web ${JSON.stringify(a)?.slice(0, 160)} | api ${JSON.stringify(b)?.slice(0, 160)}`);
  return out;
}

async function main() {
  const app = await loadWebApp();
  const webResults = new Map<string, unknown>();
  let failed = 0;
  for (const sc of SCENARIOS) {
    const prev = sc.previous ? (webResults.get(sc.previous) ?? null) : null;
    const w = await runWebScenario(app, sc, prev);
    const webJson = normalise(w.result);
    webResults.set(sc.name, webJson);
    const a = await runServerScenario(sc, prev as EngineRun['result'] | null);
    const diffs = [
      ...differences(webJson, normalise(a.result)),
      ...(w.settingsSig === a.settingsSig ? [] : ['settingsSig differs']),
      ...(JSON.stringify(w.ticks) === JSON.stringify(a.ticks) ? [] : [`ticks: web ${w.ticks} | api ${a.ticks}`]),
      ...(JSON.stringify([...w.aiCalls].sort()) === JSON.stringify([...a.aiCalls].sort())
        ? []
        : [`AI calls: web ${w.aiCalls} | api ${a.aiCalls}`])
    ];
    const r = webJson as { points: unknown[] };
    console.log(
      `${diffs.length ? 'DIFFERENT' : 'same     '}  ${sc.name.padEnd(28)} ${r.points.length} points, AI calls: ${w.aiCalls.join(', ') || 'none'}`
    );
    diffs.forEach((d) => console.log(`             ${d}`));
    if (diffs.length) failed++;
    if (write) {
      mkdirSync(GOLDEN, { recursive: true });
      const golden = {
        scenario: sc.name,
        about: sc.about,
        settingsSig: w.settingsSig,
        ticks: w.ticks,
        aiCalls: [...w.aiCalls].sort(),
        result: webJson
      };
      writeFileSync(path.join(GOLDEN, `${sc.name}.json`), JSON.stringify(golden, null, 1) + '\n');
    }
  }
  console.log(
    failed
      ? `\n${failed} of ${SCENARIOS.length} scenarios differ.`
      : `\nAll ${SCENARIOS.length} scenarios give the same result in the browser engine and the api.`
  );
  if (write) console.log(`Golden results written to ${GOLDEN}`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
