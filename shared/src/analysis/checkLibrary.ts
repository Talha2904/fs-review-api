// The approved check library and how an engagement's settings are put together from it.
// Each rule says which engine runs it:
//   code      — deterministic recalculation in checks.ts (impl lists the check ids)
//   variance  — the variance model in checks.ts
//   narrative — covered by the Claude narrative review (judgement, not an exact-match test)
//   none      — in the library but not built in the app yet
// Ported from the web app (src/data/checkLibrary.js, src/lib/ruleTemplate.js, aiDecision.js,
// engagementOptions.js); the behaviour and wording are the same.
import type { LibraryRule, RuleSetting, Setup } from './types.js';

export const LIBRARY: LibraryRule[] = [
  {
    id: 'CHK-01',
    name: 'TB balances',
    desc: 'Total debits equal total credits.',
    version: 'v1.0',
    tol: 1,
    tolKind: 'abs',
    approvedBy: 'Accounting lead',
    status: 'active',
    engine: 'code',
    impl: ['tb']
  },
  {
    id: 'CHK-02',
    name: 'TB to statements',
    desc: 'Mapped TB totals agree to each statement line, and every TB account with a balance is mapped.',
    version: 'v1.1',
    tol: 1,
    tolKind: 'abs',
    approvedBy: 'Accounting lead',
    status: 'active',
    engine: 'code',
    impl: ['tbmap', 'tbcover']
  },
  {
    id: 'CHK-03',
    name: 'Casting',
    desc: 'Recalculated subtotals and totals equal stated.',
    version: 'v1.0',
    tol: 1,
    tolKind: 'abs',
    approvedBy: 'Accounting lead',
    status: 'active',
    engine: 'code',
    impl: ['bs', 'na', 'inc', 'castall']
  },
  {
    id: 'CHK-04',
    name: 'Notes tie-out',
    desc: 'Each note total equals its statement line.',
    version: 'v1.0',
    tol: 1,
    tolKind: 'abs',
    approvedBy: 'Accounting lead',
    status: 'active',
    engine: 'code',
    impl: ['exp', 'notes']
  },
  {
    id: 'CHK-05',
    name: 'Prior-year comparatives',
    desc: 'Comparatives equal the prior-year signed statements.',
    version: 'v1.0',
    tol: 1,
    tolKind: 'abs',
    approvedBy: 'Accounting lead',
    status: 'active',
    engine: 'code',
    impl: ['cmp']
  },
  {
    id: 'CHK-06',
    name: 'Net asset movement',
    desc: 'Opening + subscriptions − redemptions + result − distributions = closing.',
    version: 'v1.0',
    tol: 1,
    tolKind: 'abs',
    approvedBy: 'Accounting lead',
    status: 'active',
    engine: 'code',
    impl: ['socna']
  },
  {
    id: 'CHK-07',
    name: 'Investments',
    desc: 'Investment schedule total equals note and TB.',
    version: 'v1.0',
    tol: 1,
    tolKind: 'abs',
    approvedBy: 'Accounting lead',
    status: 'active',
    engine: 'code',
    impl: ['note4', 'tbinv']
  },
  {
    id: 'CHK-08',
    name: 'Fair value hierarchy',
    desc: 'Level 1 + Level 2 + Level 3 = total investments.',
    version: 'v1.0',
    tol: 1,
    tolKind: 'abs',
    approvedBy: 'Accounting lead',
    status: 'active',
    engine: 'code',
    impl: ['hier']
  },
  {
    id: 'CHK-10',
    name: 'Management fee recalculation',
    desc: 'Rate × average net assets × period = stated fee.',
    version: 'v1.0',
    tol: 1,
    tolKind: 'abs',
    approvedBy: 'Accounting lead',
    status: 'active',
    engine: 'code',
    impl: ['fee']
  },
  {
    id: 'CHK-11',
    name: 'Year-on-year variances',
    desc: 'Movements at or above materiality are listed for explanation.',
    version: 'v1.0',
    tol: null,
    tolKind: 'threshold',
    approvedBy: 'Accounting lead',
    status: 'active',
    engine: 'variance'
  },
  {
    id: 'CHK-09',
    name: 'Income and expense notes',
    desc: 'Disaggregated revenue tie-out to fee schedule.',
    version: 'v0.9',
    tol: 1,
    tolKind: 'abs',
    approvedBy: 'Pending review',
    status: 'draft',
    engine: 'none',
    gap: 'Needs a fee schedule document slot and extraction.'
  },
  {
    id: 'CHK-12',
    name: 'Narrative rollover',
    desc: 'Approval and reporting-period dates in the narrative belong to this year. Director names and other carried-forward wording are covered by the narrative review (AI).',
    version: 'v1.0',
    tol: null,
    tolKind: 'exact',
    approvedBy: 'Accounting lead',
    status: 'active',
    engine: 'code',
    impl: ['dates']
  },
  {
    id: 'CHK-13',
    name: 'Disclosure checklist',
    desc: 'The reviewer completes the disclosure checklist for the client’s framework; every item must be answered before sign-off, and each “No” is a review point.',
    version: 'v1.0',
    tol: null,
    tolKind: 'completeness',
    approvedBy: 'Accounting lead',
    status: 'active',
    engine: 'checklist',
    defaultOff: true
  },
  {
    id: 'CHK-14',
    name: 'Currency and presentation',
    desc: 'Every amount with a currency is in the presentation currency.',
    version: 'v1.0',
    tol: null,
    tolKind: 'exact',
    approvedBy: 'Accounting lead',
    status: 'active',
    engine: 'code',
    impl: ['ccy']
  }
];

export const RULE_BY_ID: Record<string, LibraryRule> = Object.fromEntries(LIBRARY.map((r) => [r.id, r]));
export const RULE_FOR_IMPL: Record<string, string> = Object.fromEntries(LIBRARY.flatMap((r) => (r.impl || []).map((i) => [i, r.id])));

export const DEFAULT_SETUP: Setup = {
  fund: { name: 'Meridian Global Equity Fund ICAV', yearEnd: '2025-12-31', preparer: '', reviewer: 'A. Whitcombe', manager: '' },
  threshold: 250000,
  highMultiple: 4,
  feeRatePct: null, // null = use the prospectus rate extracted from supporting information
  feeMonths: 12,
  varianceMode: 'library', // 'library' = list every material movement · 'expectation' = material AND outside expectation
  investigatePct: 30,
  explainPct: 15,
  narrative: true,
  // Only active rules that the app can run are switched on by default.
  rules: Object.fromEntries(
    LIBRARY.map((r) => [
      r.id,
      { on: r.status === 'active' && !r.defaultOff && (r.engine === 'code' || r.engine === 'variance'), tol: r.tol, tolKind: r.tolKind }
    ])
  )
};

export const ruleOn = (setup: Pick<Setup, 'rules'> | null | undefined, id: string | undefined): boolean => !!(id && setup?.rules?.[id]?.on);

/** A new engagement starts from the library defaults with the fund details blank. */
export const NEW_ENGAGEMENT: Setup = {
  ...DEFAULT_SETUP,
  fund: { name: '', yearEnd: '', currency: 'GBP', preparer: '', reviewer: '', manager: '' }
};

/** Fills in any settings missing from an engagement saved by an earlier version (as the web app does on load). */
export function withDefaults<T extends object>(e: T | null | undefined): Setup & T {
  const src = (e || {}) as Partial<Setup>;
  const fund = { ...NEW_ENGAGEMENT.fund, ...(src.fund || {}) };
  if (fund.yearEnd && !/^\d{4}-\d{2}-\d{2}$/.test(fund.yearEnd)) fund.yearEnd = ''; // older saves held free text
  return { ...DEFAULT_SETUP, ...e, fund, rules: { ...DEFAULT_SETUP.rules, ...(src.rules || {}) } } as Setup & T;
}

/** The settings that change what the analysis produces (fund names, save times and the TB mapping do not). */
export const settingsSignature = (s: object): string =>
  JSON.stringify({
    ...s,
    fund: undefined,
    savedAt: undefined,
    createdAt: undefined,
    tbMap: undefined,
    tbMapBy: undefined,
    tbMapAt: undefined
  });

// ---- Firm library: the built-in rules plus the Administrator's edits and new rules -------------
// Saved firm config: { rules: {id: {on, tol, tolKind}}, overrides: {id: {name, desc, ...}}, custom: [rule] }

/** Figures the app extracts from the documents, usable in tie-out rules. */
export const FIGURES: { key: string; label: string; list?: boolean }[] = [
  { key: 'ca', label: 'Asset lines (statement of financial position)', list: true },
  { key: 'statedTA', label: 'Total assets, as stated' },
  { key: 'cl', label: 'Liability lines (statement of financial position)', list: true },
  { key: 'statedNA', label: 'Net assets, as stated' },
  { key: 'pyNA', label: 'Net assets at the beginning of the year' },
  { key: 'subs', label: 'Subscriptions' },
  { key: 'reds', label: 'Redemptions' },
  { key: 'ops', label: 'Increase in net assets from operations' },
  { key: 'income', label: 'Investment income lines', list: true },
  { key: 'statedIncome', label: 'Total investment income, as stated' },
  { key: 'exp', label: 'Expense note lines', list: true },
  { key: 'sciExp', label: 'Operating expenses per income statement' },
  { key: 'statedNote4', label: 'Investment note total (Note 4)' },
  { key: 'hier', label: 'Fair value hierarchy levels', list: true },
  { key: 'sched', label: 'Investment schedule lines (custodian)', list: true },
  { key: 'mgmtCharged', label: 'Management fees charged' },
  { key: 'tbDr', label: 'Trial balance total debits' },
  { key: 'tbCr', label: 'Trial balance total credits' }
];
const FIGURE_BY_KEY = Object.fromEntries(FIGURES.map((f) => [f.key, f]));
export const figureLabel = (k: string | undefined): string => {
  const f = k ? FIGURE_BY_KEY[k] : undefined;
  if (!f) return k ?? 'undefined';
  return f.list ? 'Sum of ' + f.label.charAt(0).toLowerCase() + f.label.slice(1) : f.label;
};
export const formulaText = (def: LibraryRule['def'] | undefined): string =>
  def?.terms?.length
    ? def.terms.map((t, i) => `${i ? (t.sign < 0 ? ' − ' : ' + ') : t.sign < 0 ? '− ' : ''}${figureLabel(t.key)}`).join('') +
      ' against ' +
      figureLabel(def.stated)
    : '';

export interface FirmRuleConfig {
  rules?: Record<string, RuleSetting>;
  overrides?: Record<string, Record<string, unknown>>;
  custom?: Record<string, unknown>[];
}

export function buildLibrary(config: FirmRuleConfig | null | undefined): LibraryRule[] {
  const ov = config?.overrides || {};
  const builtIn = LIBRARY.map((r) => ({ ...r, ...(ov[r.id] || {}), builtIn: true }));
  const custom = (config?.custom || []).map((r) => ({ approvedBy: '', ...r, builtIn: false }) as LibraryRule);
  return [...builtIn, ...custom];
}
const RUNNABLE = ['code', 'variance', 'custom-tieout', 'custom-narrative', 'checklist'];
export const defaultRulesFor = (library: LibraryRule[]): Record<string, RuleSetting> =>
  Object.fromEntries(
    library.map((r) => [
      r.id,
      { on: r.status === 'active' && !r.defaultOff && RUNNABLE.includes(String(r.engine)), tol: r.tol, tolKind: r.tolKind }
    ])
  );

/**
 * Check rules per engagement: the firm's template applies live, and an engagement stores only its
 * overrides (ruleOverrides). Engagements saved before that keep a full copy in `rules`, used as-is.
 */
export function effectiveRules(
  eng: { ruleOverrides?: unknown; rules?: unknown } | null | undefined,
  template: Record<string, RuleSetting>
): Record<string, RuleSetting> {
  if (eng?.ruleOverrides)
    return {
      ...template,
      ...Object.fromEntries(
        Object.entries(eng.ruleOverrides as Record<string, RuleSetting>).map(([id, o]) => [id, { ...(template[id] || {}), ...o }])
      )
    };
  if (eng?.rules) return { ...template, ...(eng.rules as Record<string, RuleSetting>) };
  return { ...template };
}
/** The client's (entity's) overrides applied to the firm template: the base a fund starts from. */
export const withOverrides = (template: Record<string, RuleSetting>, overrides: unknown): Record<string, RuleSetting> => ({
  ...template,
  ...Object.fromEntries(
    Object.entries((overrides || {}) as Record<string, RuleSetting>).map(([id, o]) => [id, { ...(template[id] || {}), ...o }])
  )
});

/**
 * The analysis settings for one fund, exactly as the web app builds them: the engagement with defaults
 * filled in, its rules from the firm template, then the client's overrides, then the fund's own.
 */
export function setupFor(
  engagement: object,
  entity: { ruleOverrides?: unknown } | null | undefined,
  config: FirmRuleConfig | null | undefined
): { setup: Setup; library: LibraryRule[] } {
  const library = buildLibrary(config);
  const template = { ...defaultRulesFor(library), ...(config?.rules || {}) };
  const active = withDefaults(engagement);
  return { setup: { ...active, rules: effectiveRules(active, withOverrides(template, entity?.ruleOverrides)) }, library };
}

// ---- the client's AI decision and review options ----------------------------------------------
// A fund may use AI only when its client said yes and the fund is not opted out. A client with no
// recorded decision is treated as "no AI" until someone records one.
export type FundAiState = 'permitted' | 'not-permitted' | 'undecided' | 'off-for-fund';
export const entityAi = (ent: { aiDecidedAt?: unknown; aiPermitted?: unknown } | null | undefined): Exclude<FundAiState, 'off-for-fund'> =>
  !ent || !ent.aiDecidedAt ? 'undecided' : ent.aiPermitted === true ? 'permitted' : 'not-permitted';
export function fundAi(
  eng: { aiOff?: unknown } | null | undefined,
  ent: { aiDecidedAt?: unknown; aiPermitted?: unknown } | null | undefined
): FundAiState {
  const e = entityAi(ent);
  return e !== 'permitted' ? e : eng?.aiOff ? 'off-for-fund' : 'permitted';
}
export const AI_REASON: Record<Exclude<FundAiState, 'permitted'>, string> = {
  undecided:
    'The client’s decision on AI has not been recorded, so this fund is reviewed without AI. A Manager records the decision on the client’s entity (Engagement › Edit Entity).',
  'not-permitted': 'The client does not permit AI, so this fund is reviewed without AI.',
  'off-for-fund': 'AI is turned off for this fund, so it is reviewed without AI.'
};
// A fund setting of '' follows its client; 'on' / 'off' overrides it.
const pick = (fundSetting: unknown, clientSetting: unknown): boolean =>
  fundSetting === 'on' ? true : fundSetting === 'off' ? false : !!clientSetting;
export const umbrellaFor = (eng: { umbrella?: unknown } | null | undefined, ent: { umbrella?: unknown } | null | undefined): boolean =>
  pick(eng?.umbrella, ent?.umbrella);
