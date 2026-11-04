// Scores an engagement's latest analysis against the demo library's answer key (FS_Review_Demo_Library,
// 02_Evaluator_Only/Expected_Findings.json). Reads only: nothing is changed and no AI is called.
// Usage: npm run score:demo -- <engagement id> <case id, e.g. IFRS-PE> [draft version, default the latest] [path to FS_Review_Demo_Library]
//
// A seeded finding counts as found when a point carries the same amount and shares a key word with it,
// or shares three key words without an amount. Matching by words is rough, so the report lists each
// pair for a person to confirm, and the negative controls to check by hand.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { loadEnv } from '../src/config/env.js';
import { createDb } from '../src/infrastructure/db/prisma.js';

interface Expected {
  finding_id: string;
  title: string;
  category: string;
  severity: string;
  expected_conclusion: string;
  profit_before_tax_adjustment: number;
  tax_expense_adjustment: number;
  profit_after_tax_adjustment: number;
  weight: number;
}
interface Case {
  case_id: string;
  entity: string;
  findings: Expected[];
  negative_controls: { id: string; topic: string; expected: string }[];
}
interface RunPoint {
  ref?: string;
  title?: string;
  basis?: string;
  pri?: string;
  kind?: string;
  amount?: number | null;
  pbtEffect?: number | null;
  taxEffect?: number | null;
  netAssetsEffect?: number | null;
  source?: string;
}

const [engagementId, caseId, draft, library = '../FS_Review_Demo_Library'] = process.argv.slice(2);
if (!engagementId || !caseId) {
  console.error('Usage: npm run score:demo -- <engagement id> <case id> [draft version] [path to FS_Review_Demo_Library]');
  process.exit(1);
}

const key = JSON.parse(readFileSync(join(library, '02_Evaluator_Only', 'Expected_Findings.json'), 'utf8')) as { cases: Case[] };
const kase = key.cases.find((c) => c.case_id === caseId);
if (!kase) {
  console.error(`No case ${caseId} in the answer key. Cases: ${key.cases.map((c) => c.case_id).join(', ')}`);
  process.exit(1);
}

const db = createDb(loadEnv().DATABASE_URL);
const run = await db.analysisRun.findFirst({
  where: { engagementId, ...(draft ? { draftVersion: Number(draft) } : {}) },
  orderBy: { at: 'desc' }
});
await db.$disconnect();
if (!run) {
  console.error(`Engagement ${engagementId} has no analysis${draft ? ` of draft v${draft}` : ''} yet.`);
  process.exit(1);
}
const points = ((run.result as { points?: RunPoint[] }).points || []).filter((p) => p.title);

const STOP = new Set(
  'the and for from with that this into than when were been have which their there under over year draft should would amount balance statements financial note notes'.split(
    ' '
  )
);
const words = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 3 && !STOP.has(w))
  );
const overlap = (a: Set<string>, b: Set<string>) => [...a].filter((w) => b.has(w)).length;
const abs = (xs: (number | null | undefined)[]) => xs.filter((x): x is number => typeof x === 'number' && x !== 0).map(Math.abs);

// every candidate pair with its strength, strongest first; each point is used once
const pairs = kase.findings.flatMap((f) => {
  const fw = words(`${f.title} ${f.expected_conclusion}`);
  // the adjustments, and any amount named in the expected conclusion ("the unsupported 600,000 change")
  const named = [...f.expected_conclusion.matchAll(/\d{1,3}(?:,\d{3})+/g)].map((m) => Number(m[0].replace(/,/g, '')));
  const fAmt = abs([f.profit_before_tax_adjustment, f.profit_after_tax_adjustment, f.tax_expense_adjustment, ...named]);
  return points.map((p, i) => {
    const text = `${p.title} ${p.basis || ''}`;
    const pw = words(text);
    const inText = [...text.matchAll(/\d{1,3}(?:,\d{3})+/g)].map((m) => Number(m[0].replace(/,/g, '')));
    const amountHit = abs([p.amount, p.pbtEffect, p.netAssetsEffect, p.taxEffect, ...inText]).some((a) => fAmt.includes(a));
    const shared = overlap(fw, pw);
    // words alone are weak evidence: without a shared amount, ask for four
    const ok = (amountHit && shared >= 2) || shared >= 4;
    return { f, i, ok, score: (amountHit ? 10 : 0) + shared };
  });
});
const usedPoint = new Set<number>(),
  matched = new Map<string, { p: RunPoint; amountHit: boolean }>();
for (const x of pairs.filter((x) => x.ok).sort((a, b) => b.score - a.score)) {
  if (matched.has(x.f.finding_id) || usedPoint.has(x.i)) continue;
  usedPoint.add(x.i);
  matched.set(x.f.finding_id, { p: points[x.i] as RunPoint, amountHit: x.score >= 10 });
}

const total = kase.findings.reduce((a, f) => a + f.weight, 0),
  got = kase.findings.filter((f) => matched.has(f.finding_id)).reduce((a, f) => a + f.weight, 0);
const quantified = kase.findings.filter((f) => {
  const m = matched.get(f.finding_id);
  return m && m.p.pbtEffect === f.profit_before_tax_adjustment;
}).length;

console.log(`\n${kase.case_id} · ${kase.entity}`);
console.log(`Analysis of ${run.analysedAt.toISOString().slice(0, 16).replace('T', ' ')} · ${points.length} points\n`);
for (const f of kase.findings) {
  const m = matched.get(f.finding_id);
  const pbt = f.profit_before_tax_adjustment;
  console.log(`${m ? 'FOUND ' : 'MISSED'} ${f.finding_id} [${f.severity}] ${f.title} (PBT ${pbt.toLocaleString('en-GB')})`);
  if (m)
    console.log(
      `       ← ${m.p.ref} ${m.p.title}${m.p.pbtEffect != null ? ` (PBT ${m.p.pbtEffect.toLocaleString('en-GB')}${m.p.pbtEffect === pbt ? ', exact' : ''})` : ''}`
    );
}
const extra = points.filter((_, i) => !usedPoint.has(i));
console.log(`\nNot matched to a seeded finding (${extra.length}): check each is a fair observation, not a false positive`);
for (const p of extra) console.log(`       ${p.ref} [${p.pri}] ${p.title}`);
console.log(`\nNegative controls (check by hand that no point asserts these):`);
for (const n of kase.negative_controls) console.log(`       ${n.id} ${n.topic}: ${n.expected}`);
console.log(
  `\nDetection ${matched.size} of ${kase.findings.length} (weighted ${Math.round((got / total) * 100)}%) · profit effect exact on ${quantified} · ${extra.length} other points\n`
);
