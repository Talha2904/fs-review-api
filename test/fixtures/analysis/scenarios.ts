// Analysis scenarios run by both engines: the web app's original pipeline (scripts/analysis-parity.ts,
// which writes golden/*.json) and the api's port (test/unit/analysisParity.test.ts, which compares with
// them). AI answers are canned and depend only on the request, so both engines see the same answers.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SampleFund as S, type DocSlot, type FirmRuleConfig, type Umbrella } from '@fs-review/shared/analysis';

export const FIXTURES = path.dirname(fileURLToPath(import.meta.url));

export interface ScenarioFile {
  name: string;
  /** path under test/fixtures/analysis; absent for a built-in sample */
  fixture?: string;
  sample?: boolean;
  readWith?: 'ai';
}
export interface Scenario {
  name: string;
  about: string;
  engagement: Record<string, unknown>;
  entity: Record<string, unknown> | null;
  config: FirmRuleConfig | null;
  files: Partial<Record<DocSlot, ScenarioFile>>;
  ai: { extract: boolean; narrative: boolean; explain: boolean; version: boolean };
  umbrella: Umbrella | null;
  /** the scenario whose result is the previous analysis (a next draft) */
  previous?: string;
  /** readings already kept for these slots, as if AI had read the same content before */
  seedReadings?: DocSlot[];
  /** 'sample' runs the scripted analysis of the built-in sample documents */
  kind: 'live' | 'sample';
}

export const fileBytes = (f: ScenarioFile): Uint8Array | null =>
  f.fixture ? new Uint8Array(readFileSync(path.join(FIXTURES, f.fixture))) : null;
export const sha256Of = (bytes: Uint8Array | null): string => (bytes ? createHash('sha256').update(bytes).digest('hex') : '');

const AI_ON = { extract: true, narrative: true, explain: true, version: true };
const AI_OFF = { extract: false, narrative: false, explain: false, version: false };
const ENTITY = {
  id: 'ent-1',
  name: 'Meridian Funds ICAV',
  client: 'Meridian',
  aiPermitted: true,
  aiBasis: 'Engagement letter',
  aiDecidedAt: '2026-01-10T09:00:00.000Z',
  ruleOverrides: {},
  umbrella: false,
  partnerSignoff: false
};
const ENGAGEMENT = {
  id: 'eng-1',
  entityId: 'ent-1',
  fund: { name: 'Meridian Global Equity Fund', yearEnd: '2025-12-31', currency: 'GBP', preparerId: 'u-prep', preparer: 'Muhammad Salman' },
  threshold: 250000,
  highMultiple: 4,
  narrative: true,
  createdAt: '2026-01-10T09:00:00.000Z',
  savedAt: '2026-01-11T09:00:00.000Z'
};
const MERIDIAN: Partial<Record<DocSlot, ScenarioFile>> = {
  cy: { name: 'MGEF_2025_draft_FS.pdf', fixture: 'meridian/cy.pdf' },
  py: { name: 'MGEF_2024_signed_FS.pdf', fixture: 'meridian/py.pdf' },
  tb: { name: 'MGEF_TB_31Dec2025.xlsx', fixture: 'meridian/tb.xlsx' },
  is: { name: 'Custodian_valuation_31Dec2025.xlsx', fixture: 'meridian/is.xlsx' },
  sup: { name: 'Board_minutes_and_prospectus.pdf', fixture: 'meridian/sup.pdf' }
};
const NEXT_DRAFT = { ...MERIDIAN, cy: { name: 'MGEF_2025_draft_FS_v3.pdf', fixture: 'meridian/cy-v3.pdf' } };
const SAMPLE: Partial<Record<DocSlot, ScenarioFile>> = Object.fromEntries(
  S.slotDefs.map((d) => [d.id, { name: d.sample, sample: true }])
) as Partial<Record<DocSlot, ScenarioFile>>;

export const SCENARIOS: Scenario[] = [
  {
    name: 'meridian-no-ai',
    about: 'Five real documents read by the app without AI; the client does not permit AI (UAT D1, I2).',
    engagement: ENGAGEMENT,
    entity: { ...ENTITY, aiPermitted: false },
    config: null,
    files: MERIDIAN,
    ai: AI_OFF,
    umbrella: null,
    kind: 'live'
  },
  {
    name: 'meridian-ai',
    about: 'The same documents with AI on: narrative points and variance explanations drafted by AI (UAT I1).',
    engagement: ENGAGEMENT,
    entity: ENTITY,
    config: null,
    files: MERIDIAN,
    ai: AI_ON,
    umbrella: null,
    kind: 'live'
  },
  {
    name: 'meridian-read-by-ai',
    about: 'The draft is read by AI by choice (low OCR confidence); the reading is kept for reuse.',
    engagement: ENGAGEMENT,
    entity: ENTITY,
    config: null,
    files: { ...MERIDIAN, cy: { ...MERIDIAN.cy!, readWith: 'ai' } },
    ai: AI_ON,
    umbrella: null,
    kind: 'live'
  },
  {
    name: 'meridian-reading-reused',
    about: 'The same draft content was read by AI before, so the kept reading is reused instead of a new call.',
    engagement: ENGAGEMENT,
    entity: ENTITY,
    config: null,
    files: { ...MERIDIAN, cy: { ...MERIDIAN.cy!, readWith: 'ai' } },
    ai: AI_ON,
    umbrella: null,
    seedReadings: ['cy'],
    kind: 'live'
  },
  {
    name: 'meridian-settings',
    about:
      'Engagement settings change the result: euro fund, lower threshold, fee rate and period, expectation mode, firm and client rule overrides, a TB mapping and custom rules.',
    engagement: {
      ...ENGAGEMENT,
      fund: { ...ENGAGEMENT.fund, currency: 'EUR' },
      threshold: 100000,
      highMultiple: 3,
      feeRatePct: 0.8,
      feeMonths: 11,
      varianceMode: 'expectation',
      investigatePct: 25,
      explainPct: 10,
      ruleOverrides: { 'CHK-12': { on: false }, 'CHK-03': { tol: 0.5, tolKind: 'pct' } },
      tbMap: {
        '1010': 'Statement of Financial Position|Financial assets at fair value through profit or loss',
        '1020': 'Statement of Financial Position|Cash and cash equivalents',
        '2010': 'Statement of Financial Position|Payable for investments purchased'
      }
    },
    entity: { ...ENTITY, ruleOverrides: { 'CHK-05': { tol: 20000 }, 'CHK-14': { on: false } } },
    config: {
      rules: { 'CHK-13': { on: true, tol: null, tolKind: 'completeness' } },
      overrides: { 'CHK-04': { name: 'Notes agree to statements', tol: 2 } },
      custom: [
        {
          id: 'CHK-15',
          name: 'Assets less liabilities',
          status: 'active',
          engine: 'custom-tieout',
          tol: 1,
          tolKind: 'abs',
          def: {
            terms: [
              { sign: 1, key: 'ca' },
              { sign: -1, key: 'cl' }
            ],
            stated: 'statedNA'
          }
        },
        {
          id: 'CHK-16',
          name: 'Going concern wording',
          status: 'active',
          engine: 'custom-narrative',
          tol: null,
          tolKind: 'exact',
          def: { instruction: 'Check the going concern note mentions the redemption request.' }
        }
      ]
    },
    files: MERIDIAN,
    ai: { extract: true, narrative: true, explain: false, version: true },
    umbrella: null,
    kind: 'live'
  },
  {
    name: 'meridian-next-draft-ai',
    about: 'A next draft analysed against the previous result with the AI version pass (UAT D5 style re-test).',
    engagement: ENGAGEMENT,
    entity: ENTITY,
    config: null,
    files: NEXT_DRAFT,
    ai: AI_ON,
    umbrella: null,
    previous: 'meridian-ai',
    kind: 'live'
  },
  {
    name: 'meridian-next-draft-no-ai',
    about: 'A next draft without AI: earlier points are matched to the new ones by title.',
    engagement: ENGAGEMENT,
    entity: { ...ENTITY, aiPermitted: false },
    config: null,
    files: NEXT_DRAFT,
    ai: AI_OFF,
    umbrella: null,
    previous: 'meridian-no-ai',
    kind: 'live'
  },
  {
    name: 'umbrella-alpha',
    about: 'Umbrella accounts: Alpha Fund read from its own columns, with the sub-fund to total cast.',
    engagement: { ...ENGAGEMENT, fund: { ...ENGAGEMENT.fund, name: 'Alpha Fund' }, umbrella: 'on', umbrellaName: 'Alpha Fund' },
    entity: { ...ENTITY, umbrella: true },
    config: null,
    files: {
      ...MERIDIAN,
      cy: { name: 'Umbrella_draft_FS.pdf', fixture: 'umbrella/cy.pdf' },
      py: { name: 'Umbrella_signed_FS.pdf', fixture: 'umbrella/py.pdf' }
    },
    ai: AI_OFF,
    umbrella: { name: 'Alpha Fund', names: ['Alpha Fund', 'Beta Fund'] },
    kind: 'live'
  },
  {
    name: 'sample-v2',
    about: 'The built-in sample documents (scripted, no AI).',
    engagement: ENGAGEMENT,
    entity: ENTITY,
    config: null,
    files: SAMPLE,
    ai: AI_ON,
    umbrella: null,
    kind: 'sample'
  },
  {
    name: 'sample-v3',
    about: 'The sample next draft (v3), with CHK-10 and the narrative review switched off.',
    engagement: { ...ENGAGEMENT, narrative: false, ruleOverrides: { 'CHK-10': { on: false } } },
    entity: ENTITY,
    config: null,
    files: SAMPLE,
    ai: AI_ON,
    umbrella: null,
    previous: 'sample-v2',
    kind: 'sample'
  }
];

// ---- canned AI: answers depend only on the request ----------------------------------------------
type Body = Record<string, unknown>;
const titleOf = (p: unknown) => String((p as { title?: string })?.title || '');

export function cannedAi(step: 'extract' | 'narrative' | 'explain' | 'version', body: Body): unknown {
  if (step === 'extract') {
    const slot = body.slot as DocSlot;
    const doc = S.docs[slot];
    const keys: Record<string, string[]> = {
      cy: [
        'ca',
        'cl',
        'statedTA',
        'statedNA',
        'pyNA',
        'subs',
        'reds',
        'ops',
        'income',
        'statedIncome',
        'exp',
        'sciExp',
        'statedNote4',
        'hier',
        'mgmtCharged'
      ],
      tb: ['tbDr', 'tbCr'],
      is: ['sched'],
      sup: ['mgmtRate'],
      py: []
    };
    return {
      title: `${doc.title} (read by AI)`,
      meta: `AI reading of ${String((body.file as { fileName?: string })?.fileName || '')}`,
      blocks: doc.blocks,
      figures: Object.fromEntries((keys[slot] || []).map((k) => [k, S.K[k]]))
    };
  }
  if (step === 'narrative') {
    const custom = (body.customChecks as { id: string; name: string }[] | undefined) || [];
    return {
      points: [
        {
          pri: 'High',
          area: 'Disclosure',
          title: 'Fair value hierarchy narrative describes the prior year position',
          basis: 'The Level 3 narrative in Note 5 repeats the signed 2024 wording.',
          amount: 12904300,
          refs: 'Note 5 · Prior year Note 5',
          follow: 'Rewrite the narrative for the current year.',
          anchor: 'The Fund holds one unlisted equity investment'
        },
        {
          pri: 'Medium',
          area: 'Related party',
          title: 'Related party note lists a director who resigned during the year',
          basis: 'Board minutes record the resignation.',
          amount: null,
          refs: 'Note 6 · SUP-3',
          follow: 'Amend the listing.',
          anchor: 'The Investment Manager is entitled'
        },
        ...custom.map((c) => ({
          pri: 'Low',
          area: 'Firm rule',
          title: `${c.name}: not addressed`,
          basis: `Custom check ${c.id}.`,
          amount: null,
          refs: c.id,
          follow: 'Review.',
          rule: c.id
        }))
      ]
    };
  }
  if (step === 'explain') {
    const lines = (body.lines as { label: string; band: string }[]) || [];
    return {
      lines: lines
        .filter((_, i) => i % 2 === 0)
        .map((l) => ({
          label: l.label,
          band: l.band === 'Investigate' ? 'Investigate' : 'Explain',
          pri: l.band === 'Investigate' ? 'Medium' : 'Low',
          expect: 'Per the manager commentary',
          note: `AI explanation for ${l.label}.`,
          action: 'Agree to the administrator analysis.'
        }))
    };
  }
  const prior = (body.priorPoints as { ref: string; title: string }[]) || [];
  const cand = (body.candidatePoints as { ref: string; title: string }[]) || [];
  const priorTitles = new Set(prior.map(titleOf));
  return {
    prior: prior.map((p, i) => ({
      ref: p.ref,
      status: /Investment note|comparative/i.test(p.title) || i === 0 ? 'resolved' : 'outstanding',
      note: `Re-tested ${p.ref}.`,
      ...(i === 1 ? { duplicateOf: cand.find((c) => c.title === p.title)?.ref } : {})
    })),
    newlyIntroduced: cand.filter((c) => !priorTitles.has(c.title)).map((c) => ({ ref: c.ref, note: `New on this draft: ${c.ref}.` }))
  };
}

/** The result as stored (JSON), with the order of documents read in parallel made stable. */
export function normalise(result: unknown): unknown {
  const r = JSON.parse(JSON.stringify(result)) as { aiReads?: Record<string, string[]> };
  if (r.aiReads) for (const k of Object.keys(r.aiReads)) r.aiReads[k] = [...(r.aiReads[k] as string[])].sort();
  return r;
}
