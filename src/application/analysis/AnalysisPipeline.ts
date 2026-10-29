// One analysis run, ported from the web app's src/lib/pipeline.js (ADR 0008, Phase 6). The steps and
// results are the same; only the edges differ: documents come from storage, the AI steps go through
// the api's own RunAiStep, and progress is reported through `tick` instead of a React state setter.
import {
  annotateFlags,
  applyV3,
  isScanned,
  parseFinancialPdf,
  parseInvestmentSchedule,
  parseTrialBalance,
  pointsFromChecks,
  rankPoints,
  ruleOn,
  runChecks,
  SampleFund as S,
  varianceModel,
  varianceOpts,
  withSetup,
  type AnalysisResult,
  type Doc,
  type DocSlot,
  type Docs,
  type Figures,
  type LibraryRule,
  type PdfContent,
  type Point,
  type Reading,
  type Setup,
  type Umbrella,
  type VarNote,
  type VarianceRow
} from '@fs-review/shared/analysis';

import type { DocumentReader } from '../ports/DocumentReader.js';

export const SLOTS: readonly DocSlot[] = ['cy', 'py', 'tb', 'is', 'sup'];
/** The figures each slot supplies when it is a built-in sample. */
const SLOT_KEYS: Record<DocSlot, string[]> = {
  cy: [
    'ca',
    'cl',
    'statedTA',
    'statedNA',
    'pyNA',
    'pyOpenNA',
    'subs',
    'reds',
    'dists',
    'ops',
    'income',
    'statedIncome',
    'exp',
    'sciExp',
    'statedNote4',
    'hier',
    'mgmtCharged'
  ],
  py: [],
  tb: ['tbDr', 'tbCr'],
  is: ['sched'],
  sup: ['mgmtRate']
};
const SAMPLE_K: Figures = { ...S.K, pyOpenNA: 379904870 };
/** The progress steps the screens show; `tick(n)` reports that step n of these has finished. */
export const ANALYSIS_STEPS: readonly string[] = S.steps;
const pad = (n: number) => 'RP-' + String(n).padStart(2, '0');

// Sample points are scripted, so the engagement removes the ones whose rule is switched off.
// RP-01 arises from either CHK-07 or CHK-08, so it stays while either is on.
const DEMO_RULES: Record<string, string[]> = {
  'RP-01': ['CHK-07', 'CHK-08'],
  'RP-03': ['CHK-11'],
  'RP-06': ['CHK-10'],
  'RP-08': ['CHK-05']
};
const DEMO_NARRATIVE = ['RP-02', 'RP-04', 'RP-05', 'RP-07'];
const keepDemo = (p: Point, setup: Setup): boolean =>
  DEMO_NARRATIVE.includes(p.ref as string)
    ? !!setup.narrative
    : DEMO_RULES[p.ref as string]
      ? (DEMO_RULES[p.ref as string] as string[]).some((id) => ruleOn(setup, id))
      : true;

const docShell = (slot: DocSlot, ex: Reading, fileName: string): Doc => ({
  ...S.docs[slot],
  title: ex.title || S.docs[slot].title,
  meta: ex.meta || '',
  blocks: ex.blocks || [],
  sub: fileName,
  ...(ex.umbrellaCast ? { umbrellaCast: ex.umbrellaCast } : {}),
  ...(ex.ocr ? { ocr: ex.ocr } : {})
});

/** The analysis of the built-in sample documents: scripted, no AI and no files. Draft v2, or v3 for the next draft. */
export function sampleAnalysis(version: 2 | 3, setup: Setup, tick: (step: number) => void = () => undefined): AnalysisResult {
  for (let i = 1; i <= S.steps.length; i++) tick(i);
  const v3 = version === 3;
  const docs: Docs = { ...S.docs, cy: v3 ? applyV3(S.docs.cy) : S.docs.cy };
  const K: Figures = { ...SAMPLE_K, statedNote4: v3 ? S.K.statedNote4v3 : S.K.statedNote4 }; // raw figures; engagement settings apply when checks run
  const points = S.basePoints
    .concat(v3 ? S.v3Points : [])
    .filter((p) => keepDemo(p, setup))
    .map((p) => {
      const agent = (v3 ? p.v3 : p.v2) as string;
      return { ...p, agent, agentNote: (v3 ? p.v3note : p.v2note) as string, status: agent === 'resolved' ? 'cleared' : 'open' };
    });
  return {
    docs,
    K,
    points,
    varNotes: ruleOn(setup, 'CHK-11') ? S.VAR_NOTES : {},
    version: v3 ? 3 : 2,
    priorResolved: v3 ? [] : S.resolvedV2,
    demo: true
  };
}

/** A current document of the fund, with its bytes fetched only when they are read. */
export interface AnalysisFile {
  name: string;
  sample: boolean;
  sha256: string;
  /** 'ai' when someone chose AI to read a scan with low OCR confidence */
  readWith: string | null;
  bytes(): Promise<Uint8Array>;
}

/** The four Claude steps, in the shapes the pipeline uses. */
export interface AnalysisAi {
  extract(slot: DocSlot, file: AnalysisFile): Promise<Reading>;
  narrative(
    docs: Docs,
    threshold: number,
    highMultiple: number | undefined,
    customChecks: { id: string; name: string; instruction: string }[]
  ): Promise<Point[]>;
  explain(lines: VarianceRow[], docs: Docs, threshold: number, growth: number): Promise<Record<string, VarNote>>;
  versionPass(input: {
    priorPoints: Point[];
    candidatePoints: Point[];
    previousDraft: Doc | undefined;
    newDraft: Doc | undefined;
    supporting: Doc | undefined;
  }): Promise<{
    prior?: { ref: string; status: string; note: string; duplicateOf?: string }[];
    newlyIntroduced?: { ref: string; note: string }[];
  }>;
}

/** AI readings kept by document content, so the same file is never sent to AI twice. */
export interface ReadingCache {
  get(slot: DocSlot, sha256: string): Promise<Reading | null>;
  put(slot: DocSlot, sha256: string, reading: Reading): Promise<void>;
}

export interface LiveAnalysisInput {
  files: Partial<Record<DocSlot, AnalysisFile>>;
  setup: Setup;
  library: LibraryRule[];
  /** the previous result, for the version pass on a next draft; null for a fresh analysis */
  previous: AnalysisResult | null;
  /** which AI steps may run; skipped steps are listed in result.aiSkipped */
  ai: { extract: boolean; narrative: boolean; explain: boolean; version: boolean };
  umbrella: Umbrella | null;
  /** the fund's presentation currency, for amounts in point wording */
  currency: string;
  /**
   * Points the fund already has (a fresh analysis after an earlier one): a finding with the same title keeps
   * its reference, and new findings are numbered after the highest reference used, so a reference never
   * passes to a different finding with the old one's status and thread.
   */
  existing?: { ref: string; title: string }[];
}

export interface LiveAnalysisDeps {
  reader: DocumentReader;
  ai: AnalysisAi;
  readings: ReadingCache | null;
  /** reads a scanned PDF with OCR (no AI); absent when OCR is not available */
  ocr: ((file: AnalysisFile) => Promise<PdfContent>) | null;
  tick: (step: number) => void;
}

export async function liveAnalysis(input: LiveAnalysisInput, deps: LiveAnalysisDeps): Promise<AnalysisResult> {
  const { files, setup, library, previous, ai, umbrella, currency, existing = [] } = input;
  const aiSkipped: string[] = [],
    aiReads = { read: [] as string[], reused: [] as string[], local: [] as string[] };
  const th = setup.threshold;
  const docs: Docs = {},
    figures: Figures = {};
  let step = 0;
  const next = () => deps.tick(++step);

  // 1. Extraction (parallel). Sample files fall back to the sample fund for that slot.
  const extracted = await Promise.all(
    SLOTS.filter((s) => files[s]).map(async (slot): Promise<[DocSlot, Doc, Figures]> => {
      const f = files[slot] as AnalysisFile;
      if (f.sample) return [slot, { ...S.docs[slot] }, Object.fromEntries(SLOT_KEYS[slot].map((k) => [k, SAMPLE_K[k]]))];
      // An Excel trial balance or investment schedule is read by the app itself, without AI, when its
      // layout is recognised; otherwise it is read by AI.
      if ((slot === 'tb' || slot === 'is') && /\.xlsx$/i.test(f.name || '')) {
        const sheets = await deps.reader.xlsxSheets(await f.bytes());
        const local = slot === 'tb' ? parseTrialBalance(sheets) : parseInvestmentSchedule(sheets);
        if (local) {
          aiReads.local.push(slot);
          return [slot, docShell(slot, local, f.name), local.figures || {}];
        }
      }
      // A digitally produced PDF of the statements or supporting information is read by the app when it
      // finds every figure; a partial reading is used only when AI is not available to read it fully.
      if (['cy', 'py', 'sup'].includes(slot) && /\.pdf$/i.test(f.name || '') && f.readWith !== 'ai') {
        let content = await deps.reader.pdfContent(await f.bytes());
        // scanned: read it with OCR on this server (no AI)
        if (isScanned(content) && deps.ocr) {
          const before = content;
          content = await deps.ocr(f).catch(() => before);
        }
        const local = parseFinancialPdf(content, slot, slot === 'sup' ? null : umbrella);
        if (local && (!local.local?.missing?.length || ai.extract === false)) {
          aiReads.local.push(slot);
          return [slot, docShell(slot, local, f.name), local.figures || {}];
        }
      }
      const cached = deps.readings && f.sha256 ? await deps.readings.get(slot, f.sha256) : null;
      const ex = cached || (await deps.ai.extract(slot, f));
      if (cached) aiReads.reused.push(slot);
      else {
        aiReads.read.push(slot);
        if (deps.readings && f.sha256) await deps.readings.put(slot, f.sha256, ex);
      }
      return [slot, docShell(slot, ex, f.name), ex.figures || {}];
    })
  );
  extracted.forEach(([slot, doc, fig]) => {
    docs[slot] = doc;
    Object.assign(figures, fig);
  });
  next();
  next();
  next();

  const K: Figures = { mgmtRate: undefined, ...figures }; // raw extracted figures; engagement settings apply when checks run
  const checks = runChecks(withSetup(K, setup), setup, docs, library);
  const checkPoints = pointsFromChecks(checks, th, setup.highMultiple, currency);
  next();
  next();

  // 2. Narrative review
  const customNarrative = library
    .filter((r) => r.engine === 'custom-narrative' && ruleOn(setup, r.id))
    .map((r) => ({ id: r.id, name: r.name, instruction: r.def?.instruction || '' }));
  if (setup.narrative && ai.narrative === false) aiSkipped.push('Narrative review');
  const narrative =
    setup.narrative && ai.narrative !== false
      ? (await deps.ai.narrative(docs, th, setup.highMultiple, customNarrative)).map((p) => ({ ...p, aiDrafted: true }))
      : [];
  next();

  // 3. Variance commentary on lines outside expectation
  const growth = K.pyNA && K.statedNA ? K.statedNA / K.pyNA - 1 : 0;
  const flagged = ruleOn(setup, 'CHK-11')
    ? varianceModel(docs.cy, {}, th, growth, { ...varianceOpts(setup), currency }).rows.filter((r) => r.band !== 'Expected' && !r.sub)
    : [];
  if (flagged.length && ai.explain === false) aiSkipped.push('Variance explanations');
  const rawNotes = flagged.length && ai.explain !== false ? await deps.ai.explain(flagged, docs, th, growth) : {};
  const varNotes: Record<string, VarNote> = Object.fromEntries(Object.entries(rawNotes).map(([k, v]) => [k, { ...v, aiDrafted: true }]));
  next();

  let candidates = rankPoints([...checkPoints, ...narrative]);
  let points: Point[];
  const priorResolved: unknown[] = [];

  // New references continue after the highest one used so far, so a reference is never reused.
  const nextRef = () => Math.max(0, ...(previous?.points || []).map((p) => +(/^RP-(\d+)$/.exec(p.ref || '')?.[1] || 0))) + 1;
  if (!previous) {
    const free = new Map(existing.map((e) => [e.title, e.ref]));
    let n = Math.max(0, ...existing.map((e) => +(/^RP-(\d+)$/.exec(e.ref)?.[1] || 0)));
    points = candidates.map((p) => {
      const kept = free.get(p.title);
      if (kept) free.delete(p.title);
      return { ...p, ref: kept ?? pad(++n), status: 'open', agent: 'new', agentNote: 'Raised on this version.' };
    });
  } else if (ai.version === false) {
    // Version pass without AI: earlier points are matched to this draft's points by title.
    aiSkipped.push('Version pass');
    const prior = previous.points.filter((p) => p.agent !== 'resolved'),
      start = nextRef();
    const byTitle = new Map(candidates.map((c) => [c.title, c]));
    const carried = prior.map((p) =>
      byTitle.has(p.title)
        ? {
            ...p,
            ...byTitle.get(p.title),
            ref: p.ref,
            status: p.status,
            agent: 'outstanding',
            agentNote: 'Still raised on this draft (matched by the app, not AI).'
          }
        : { ...p, agent: 'resolved', agentNote: 'No longer raised on this draft (matched by the app, not AI).' }
    );
    const priorTitles = new Set(prior.map((p) => p.title));
    const fresh = candidates
      .filter((c) => !priorTitles.has(c.title))
      .map((c, i) => ({ ...c, ref: pad(start + i), status: 'open', agent: 'new', agentNote: 'Raised on this draft.' }));
    points = [...carried, ...fresh];
  } else {
    // 4. Version pass against the previous result
    const start = nextRef();
    candidates = candidates.map((p, i) => ({ ...p, ref: pad(start + i) }));
    const prior = previous.points.filter((p) => p.agent !== 'resolved');
    const vp = await deps.ai.versionPass({
      priorPoints: prior,
      candidatePoints: candidates,
      previousDraft: previous.docs.cy,
      newDraft: docs.cy,
      supporting: docs.sup
    });
    const byRef = Object.fromEntries((vp.prior || []).map((x) => [x.ref, x]));
    const carried = prior.map((p) => {
      const r = byRef[p.ref as string] || { status: 'outstanding', note: 'Not re-tested.' };
      return { ...p, agent: r.status, agentNote: r.note, status: r.status === 'resolved' ? 'cleared' : p.status };
    });
    const dupes = new Set((vp.prior || []).map((x) => x.duplicateOf).filter(Boolean));
    const fresh = (vp.newlyIntroduced || [])
      .filter((x) => !dupes.has(x.ref))
      .map((x) => {
        const c = candidates.find((c) => c.ref === x.ref);
        return c && { ...c, status: 'open', agent: 'new', agentNote: x.note };
      })
      .filter((p): p is Point & { status: string; agent: string; agentNote: string } => !!p);
    points = [...carried, ...fresh] as Point[];
  }
  next();

  const draft = annotateFlags(docs.cy, points);
  if (draft) docs.cy = draft;
  return { docs, K, points, varNotes, version: previous ? previous.version + 1 : 1, priorResolved, demo: false, aiSkipped, aiReads };
}
