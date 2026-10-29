// Deterministic review logic. No Claude calls here: arithmetic must be reproducible.
// Ported from the web app's src/lib/review.js with the same results and wording. Money in point titles
// and variance notes is shown in `currency` (the web app passes its module setting implicitly).
import { formulaText, RULE_FOR_IMPL, ruleOn } from './checkLibrary.js';
import { docCheckRows } from './docChecks.js';
import { fmt, pctLabel, sum, sym } from './format.js';
import { checkTbMapping } from './tbMapping.js';
import type { Check, Doc, Docs, Figures, LibraryRule, Point, Priority, RuleSetting, Setup, VarNote } from './types.js';

const has = (...xs: unknown[]): boolean => xs.every((x) => x !== undefined && x !== null && (!Array.isArray(x) || x.length));
/** A figure the guard above has already checked is present. */
const n = (x: unknown): number => x as number;

interface CheckDef {
  id: string;
  name: string;
  d: (K: Figures) => string;
  comp: (K: Figures) => number | null | undefined;
  stated: (K: Figures) => number | null | undefined;
  area: string;
  refs: string;
  anchor: string;
  follow: string;
}

export const CHECKS: CheckDef[] = [
  {
    id: 'bs',
    name: 'Balance sheet casts',
    d: () => 'Asset lines against stated total assets',
    comp: (K) => (has(K.ca) ? sum(K.ca) : null),
    stated: (K) => K.statedTA,
    area: 'Primary statements',
    refs: 'Statement of financial position',
    anchor: 'Total assets',
    follow: 'Obtain a recast statement of financial position and agree each line to the trial balance.'
  },
  {
    id: 'na',
    name: 'Net assets equal assets less liabilities',
    d: () => 'Recomputed from the balance sheet',
    comp: (K) => (has(K.statedTA, K.cl) ? n(K.statedTA) - sum(K.cl) : null),
    stated: (K) => K.statedNA,
    area: 'Primary statements',
    refs: 'Statement of financial position',
    anchor: 'Net assets attributable',
    follow: 'Agree total liabilities and net assets to the trial balance.'
  },
  {
    id: 'tb',
    name: 'Trial balance is in balance',
    d: () => 'Total debits against total credits',
    comp: (K) => K.tbDr,
    stated: (K) => K.tbCr,
    area: 'Ledger',
    refs: 'Trial balance',
    anchor: 'Totals',
    follow: 'Obtain a balanced trial balance from the administrator.'
  },
  {
    id: 'socna',
    name: 'Movement in net assets agrees to the balance sheet',
    d: (K) => `Opening plus subscriptions less redemptions plus result${K.dists ? ' less distributions' : ''}`,
    comp: (K) => (has(K.pyNA, K.subs, K.reds, K.ops) ? n(K.pyNA) + n(K.subs) - n(K.reds) + n(K.ops) - (K.dists || 0) : null),
    stated: (K) => K.statedNA,
    area: 'Primary statements',
    refs: 'Changes in net assets · Statement of financial position',
    anchor: 'Net assets at the end of the year',
    follow: 'Reconcile the statement of changes in net assets to the balance sheet and the dealing records.'
  },
  {
    id: 'note4',
    name: 'Investment note agrees to the custodian schedule',
    d: () => 'Schedule total against the Note 4 total',
    comp: (K) => (has(K.sched) ? sum(K.sched) : null),
    stated: (K) => K.statedNote4,
    area: 'Investments',
    refs: 'Note 4 · Investment schedule',
    anchor: 'Total financial assets at FVTPL',
    follow: 'Obtain a revised investment note agreed to the custodian valuation report.'
  },
  {
    id: 'hier',
    name: 'Fair value hierarchy agrees to the investment note',
    d: () => 'Levels 1 to 3 against the Note 4 total',
    comp: (K) => (has(K.hier) ? sum(K.hier) : null),
    stated: (K) => K.statedNote4,
    area: 'Investments',
    refs: 'Note 5 · Note 4',
    anchor: 'Total financial assets at FVTPL',
    follow: 'Reconcile the hierarchy note to the investment note.'
  },
  {
    id: 'exp',
    name: 'Expense note agrees to the income statement',
    d: () => 'Expense lines against the charge for the year',
    comp: (K) => (has(K.exp) ? sum(K.exp) : null),
    stated: (K) => K.sciExp,
    area: 'Expenses',
    refs: 'Note 3 · Income statement',
    anchor: 'Total operating expenses',
    follow: 'Reconcile the expense note to the income statement and the ledger.'
  },
  {
    id: 'inc',
    name: 'Total investment income casts',
    d: () => 'Income lines against stated total',
    comp: (K) => (has(K.income) ? sum(K.income) : null),
    stated: (K) => K.statedIncome,
    area: 'Income',
    refs: 'Income statement',
    anchor: 'Total investment income',
    follow: 'Obtain a recast income statement.'
  },
  {
    id: 'fee',
    name: 'Management fee at the prospectus rate',
    d: (K) =>
      has(K.pyNA, K.statedNA, K.mgmtRate)
        ? `Average net assets ${fmt(Math.round((n(K.pyNA) + n(K.statedNA)) / 2))} at ${(n(K.mgmtRate) * 100).toFixed(2)}% for ${K.feeMonths ?? 12} months`
        : 'Rate or net assets not available',
    comp: (K) =>
      has(K.pyNA, K.statedNA, K.mgmtRate)
        ? Math.round((((n(K.pyNA) + n(K.statedNA)) / 2) * n(K.mgmtRate) * (K.feeMonths ?? 12)) / 12)
        : null,
    stated: (K) => K.mgmtCharged,
    area: 'Expenses',
    refs: 'Note 3 · Prospectus',
    anchor: 'Management fees',
    follow: 'Obtain the monthly fee computation and recompute two months on the valuation-point net asset value.'
  }
];

// CHK-05: every prior year figure in the draft agrees to the signed accounts.
// Lines are matched by label within the same statement or note heading.
function comparatives(cy: Doc, py: Doc, tol: number): { matched: number; diffs: { label: string; got: number; want: number }[] } {
  const tables = (doc: Doc) => {
    const out: { head: string; b: (typeof doc.blocks)[number] }[] = [];
    let head = '';
    (doc?.blocks || []).forEach((b) => {
      if (b.k === 'head') head = b.title as string;
      else if (b.k === 'table') out.push({ head, b });
    });
    return out;
  };
  const norm = (s: unknown) =>
    String(s || '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  const signed: Record<string, number> = {};
  tables(py).forEach(({ head, b }) =>
    b.rows!.forEach((r) => {
      if (r.v?.[0] != null) signed[norm(head) + '|' + norm(r.l)] = r.v[0];
    })
  );
  let matched = 0;
  const diffs: { label: string; got: number; want: number }[] = [];
  tables(cy).forEach(({ head, b }) => {
    if (!(b.cols?.length === 2 && /^\d{4}$/.test(b.cols[1] as string))) return;
    b.rows!.forEach((r) => {
      const key = norm(head) + '|' + norm(r.l),
        want = signed[key],
        got = r.v?.[1];
      if (want == null || got == null) return;
      matched++;
      if (Math.abs(got - want) > tol) diffs.push({ label: r.l, got, want });
    });
  });
  return { matched, diffs };
}

const NOT_TESTED = { comp: null, stated: null, diff: null, result: 'Not tested' as const };

/** Runs only the checks switched on in the engagement, at the tolerance set there. */
export function runChecks(K: Figures, setup: Setup, docs: Docs | null | undefined, library: LibraryRule[] = []): Check[] {
  const tolOf = (id: string): RuleSetting => setup?.rules?.[RULE_FOR_IMPL[id] as string] || { tol: 1, tolKind: 'abs' };
  const out: Check[] = CHECKS.filter((c) => ruleOn(setup, RULE_FOR_IMPL[c.id])).map((c) => {
    const comp = c.comp(K) ?? null,
      stated = c.stated(K) ?? null,
      rule = RULE_FOR_IMPL[c.id];
    const base = { id: c.id, name: c.name, area: c.area, refs: c.refs, anchor: c.anchor, follow: c.follow, rule, detail: c.d(K) };
    if (comp == null || stated == null) return { ...base, comp, stated, diff: null, result: 'Not tested' as const };
    const diff = n(stated) - n(comp),
      t = tolOf(c.id);
    const tol = t.tolKind === 'pct' ? (Math.abs(n(stated)) * (t.tol || 0)) / 100 : (t.tol ?? 0);
    return { ...base, comp, stated, diff, result: Math.abs(diff) <= tol ? ('Agrees' as const) : ('Difference' as const) };
  });
  // Tie-out rules added by the Administrator: signed sum of figures against a stated figure.
  library
    .filter((r) => r.engine === 'custom-tieout' && ruleOn(setup, r.id))
    .forEach((r) => {
      const val = (k: string | undefined): number | null | undefined => {
        const x = k === undefined ? undefined : K[k];
        return Array.isArray(x) ? (x.length ? sum(x) : null) : x;
      };
      const terms = r.def?.terms || [],
        parts = terms.map((t) => val(t.key)),
        stated = val(r.def?.stated);
      const base = {
        id: r.id,
        rule: r.id,
        name: r.name,
        area: 'Firm rule',
        refs: r.name,
        anchor: '',
        detail: formulaText(r.def),
        follow: 'Obtain the administrator’s reconciliation of the figures in this rule and agree the corrected amount to source.'
      };
      if (!terms.length || parts.some((v) => v == null) || stated == null) {
        out.push({ ...base, ...NOT_TESTED });
        return;
      }
      const comp = terms.reduce((a, t, i) => a + (t.sign < 0 ? -1 : 1) * n(parts[i]), 0),
        diff = stated - comp;
      const s = setup.rules[r.id] || {},
        tol = s.tolKind === 'pct' ? (Math.abs(stated) * (s.tol || 0)) / 100 : (s.tol ?? 0);
      out.push({ ...base, comp, stated, diff, result: Math.abs(diff) <= tol ? 'Agrees' : 'Difference' });
    });
  // Document-level checks: full casting (CHK-03), notes tie-out (CHK-04), schedule to ledger (CHK-07),
  // narrative dates (CHK-12) and currency (CHK-14).
  out.push(...docCheckRows(docs, setup, ruleOn));
  // CHK-02: the fund's trial balance mapping (saved on the engagement) against the draft statements.
  if (ruleOn(setup, 'CHK-02')) {
    const base = {
      rule: 'CHK-02',
      area: 'Trial balance',
      refs: 'Trial balance · primary statements',
      follow: 'Agree the line to the ledger: correct the statements or the mapping, or obtain the administrator’s reconciliation.'
    };
    const r = setup.rules?.['CHK-02'] || {},
      tb = docs?.tb,
      cy = docs?.cy;
    const name = 'Trial balance agrees to the statements';
    if (!tb || !cy) out.push({ ...base, id: 'tbmap', name, detail: 'Trial balance or draft statements not available', ...NOT_TESTED });
    else {
      const res = checkTbMapping(docs, setup.tbMap || {}, 0);
      const tolFor = (amt: number) => (r.tolKind === 'pct' ? (Math.abs(amt) * (r.tol || 0)) / 100 : (r.tol ?? 1));
      const bad = res.results.filter((l) => Math.abs(l.diff) > tolFor(l.amount));
      const f = bad[0];
      if (!res.mappedCount)
        out.push({
          ...base,
          id: 'tbmap',
          name,
          detail: `No accounts mapped yet: map the ${res.accounts.length} trial balance accounts to the statement lines`,
          ...NOT_TESTED
        });
      else if (!f)
        out.push({
          ...base,
          id: 'tbmap',
          name,
          detail: `${res.results.length} statement lines agree to ${res.mappedCount} mapped accounts`,
          comp: null,
          stated: null,
          diff: 0,
          result: 'Agrees'
        });
      else {
        const onSide = f.side === 'dr' ? f.tb : -f.tb;
        out.push({
          ...base,
          id: 'tbmap',
          name,
          anchor: f.label,
          comp: onSide,
          stated: Math.abs(f.amount),
          diff: f.diff,
          result: 'Difference',
          detail: `${res.results.length} lines checked; ${bad.length} ${bad.length === 1 ? 'differs' : 'differ'}, first is ${f.label} (accounts ${f.accounts.map((a) => a.code).join(', ')})`
        });
      }
      if (res.mappedCount) {
        const left = res.unmapped.reduce((a, x) => a + Math.abs(x.bal), 0);
        out.push({
          ...base,
          id: 'tbcover',
          name: 'Every trial balance account is mapped',
          comp: null,
          stated: null,
          diff: res.unmapped.length ? left : 0,
          result: res.unmapped.length ? 'Difference' : 'Agrees',
          detail: res.unmapped.length
            ? `${res.unmapped.length} account${res.unmapped.length === 1 ? '' : 's'} with a balance not mapped: ${res.unmapped
                .slice(0, 3)
                .map((a) => `${a.code} ${a.name}`)
                .join('; ')}${res.unmapped.length > 3 ? '…' : ''}`
            : `All ${res.accounts.length} accounts with a balance are mapped`,
          follow: 'Map each remaining account to its statement line, or establish why it is not presented.'
        });
      }
    }
  }
  if (ruleOn(setup, 'CHK-05')) {
    const base = {
      id: 'cmp',
      rule: 'CHK-05',
      name: 'Comparatives agree to the signed prior year',
      area: 'Comparatives',
      refs: 'Prior year accounts',
      follow: 'Restore the signed comparative, or disclose the restatement and its effect.'
    };
    if (!docs?.cy || !docs?.py) out.push({ ...base, detail: 'Prior year accounts not available', ...NOT_TESTED });
    else {
      const { matched, diffs } = comparatives(docs.cy, docs.py, setup.rules['CHK-05']?.tol ?? 1);
      const first = diffs[0];
      if (!matched) out.push({ ...base, detail: 'No comparative lines could be matched by label', ...NOT_TESTED });
      else if (!first)
        out.push({
          ...base,
          detail: `${matched} comparative lines matched to the signed accounts`,
          comp: null,
          stated: null,
          diff: 0,
          result: 'Agrees'
        });
      else
        out.push({
          ...base,
          anchor: first.label,
          comp: first.want,
          stated: first.got,
          diff: first.got - first.want,
          result: 'Difference',
          detail: `${matched} lines matched; ${diffs.length} ${diffs.length === 1 ? 'differs' : 'differ'}, first is ${first.label}`
        });
    }
  }
  // A difference in a document read by OCR may be a misread digit: say so, so it is confirmed first.
  const ocrDocs = (['cy', 'py'] as const).filter((k) => docs?.[k]?.ocr).map((k) => (k === 'cy' ? 'draft' : 'signed accounts'));
  if (ocrDocs.length)
    out.forEach((c) => {
      if (c.result === 'Difference')
        c.detail = `${c.detail} · the ${ocrDocs.join(' and ')} ${ocrDocs.length === 1 ? 'was' : 'were'} read by OCR from a scan: confirm the figures against the document first`;
    });
  return out;
}

export function pointsFromChecks(checks: Check[], th: number, highMultiple = 4, currency = 'GBP'): Point[] {
  const seen = new Set<unknown>();
  return checks
    .filter((c) => c.result === 'Difference')
    .filter((c) => {
      const key = c.count ? c.id : Math.abs(n(c.diff));
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((c): Point => {
      // checks that count findings (currency, dates) are not money differences
      if (c.count)
        return {
          pri: 'Medium',
          area: c.area,
          title: `${c.name}: ${c.diff} found`,
          basis: `${c.detail}.`,
          amount: null,
          refs: c.refs,
          follow: c.follow,
          anchor: c.anchor,
          rule: c.rule,
          source: 'check'
        };
      const amt = Math.abs(n(c.diff));
      return {
        pri: amt >= th * highMultiple ? 'High' : amt >= th ? 'Medium' : 'Low',
        area: c.area,
        title: `${c.name} — difference of ${sym(currency)}${fmt(amt)}`,
        basis: `Recomputed ${fmt(c.comp)} against ${fmt(c.stated)} per the accounts, a difference of ${fmt(amt)}. ${c.detail}.`,
        amount: amt,
        refs: c.refs,
        follow: c.follow,
        anchor: c.anchor,
        rule: c.rule,
        source: 'check'
      };
    });
}

const RANK: Record<Priority, number> = { High: 0, Medium: 1, Low: 2 };
export const rankPoints = <P extends Point>(ps: P[]): P[] =>
  ps.slice().sort((a, b) => RANK[a.pri] - RANK[b.pri] || (n(b.amount) || 0) - (n(a.amount) || 0));

/** Attaches each point's ref to the line or paragraph it is anchored on, so the viewer can highlight it. */
export function annotateFlags(doc: Doc | undefined, points: Point[]): Doc | undefined {
  if (!doc) return doc;
  const norm = (s: unknown) =>
    String(s || '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  const blocks = doc.blocks.map((b) => {
    if (b.k === 'para') {
      const p = points.find((p) => p.anchor && norm(b.text).startsWith(norm(p.anchor).slice(0, 40)));
      return p ? { ...b, flag: p.ref } : b;
    }
    if (b.k === 'table')
      return {
        ...b,
        rows: b.rows!.map((r) => {
          const p = points.find((p) => p.anchor && norm(r.l).startsWith(norm(p.anchor)));
          return p ? { ...r, flag: p.ref } : r;
        })
      };
    return b;
  });
  return { ...doc, blocks } as Doc;
}

/** Sample documents only: applies the v3 overrides embedded in the sample data. */
export function applyV3(doc: Doc): Doc {
  return {
    ...doc,
    blocks: doc.blocks.map((b) => {
      if (b.k === 'para')
        return { ...b, text: (b.v3text as string) || b.text, flag: b.v3flag !== undefined ? b.v3flag : b.flag } as typeof b;
      if (b.k === 'table')
        return {
          ...b,
          rows: b.rows!.map(
            (r) => ({ ...r, v: (r.v3v as (number | null)[]) || r.v, flag: r.v3flag !== undefined ? r.v3flag : r.flag }) as typeof r
          )
        };
      return b;
    })
  };
}

const BAND_RANK: Record<string, number> = { Expected: 0, Explain: 1, Investigate: 2 };

const isCyPy = (cols: string[] | undefined): boolean =>
  !!cols && cols.length === 2 && /^\d{4}$/.test(cols[0]!) && /^\d{4}$/.test(cols[1]!) && +cols[0]! > +cols[1]!;

export interface VarianceRow extends Omit<VarNote, 'onlyIfFlagged'> {
  label: string;
  group: string;
  sub: boolean;
  cy: number | null | undefined;
  py: number | null | undefined;
  delta: number;
  pct: number | null;
  flag: string;
}
export interface VarianceOptions {
  mode?: string | undefined;
  investigatePct?: number | undefined;
  explainPct?: number | undefined;
  currency?: string | undefined;
}

/**
 * Prior year to current year comparison of every two-column line in the draft. mode 'library' lists
 * every material movement (CHK-11 as approved); 'expectation' lists only material movements that are
 * also outside the net-asset expectation.
 */
export function varianceModel(
  cyDoc: Doc | null | undefined,
  notes: Record<string, VarNote> | null | undefined,
  th: number,
  growth: number,
  opts: VarianceOptions = {}
): { groups: { title: string; rows: VarianceRow[] }[]; rows: VarianceRow[] } {
  const { mode = 'library', investigatePct = 30, explainPct = 15, currency = 'GBP' } = opts;
  const S = sym(currency);
  const rows: VarianceRow[] = [],
    groups: { title: string; rows: VarianceRow[] }[] = [];
  let cur: { title: string; rows: VarianceRow[] } | null = null;
  const G = growth || 0,
    gLabel = pctLabel(G * 100);
  (cyDoc?.blocks || []).forEach((b) => {
    if (b.k === 'head') {
      cur = { title: b.title as string, rows: [] };
      groups.push(cur);
      return;
    }
    const group = cur as { title: string; rows: VarianceRow[] } | null;
    if (b.k !== 'table' || !group || !isCyPy(b.cols)) return;
    b.rows!.forEach((r) => {
      if (r.h || rows.some((x) => x.label === r.l)) return;
      const [a, p] = r.v || [];
      if (a == null && p == null) return;
      if (r.dp === 4 || /shares in issue|per share/i.test(r.l)) return;
      const delta = (a || 0) - (p || 0);
      const pct = p ? (delta / Math.abs(p)) * 100 : null;
      const absD = Math.abs(delta),
        absP = pct == null ? null : Math.abs(pct);
      let note = notes?.[r.l];
      if (note && note.onlyIfFlagged && r.flag !== note.onlyIfFlagged) note = undefined;
      const exp = p == null ? null : p * (1 + G);
      const absDev = exp ? Math.abs((((a || 0) - exp) / Math.abs(exp)) * 100) : null;
      const off = exp == null ? 0 : Math.abs((a || 0) - exp);
      let o: Pick<VarNote, 'band' | 'pri' | 'expect' | 'note' | 'action'>;
      if (r.b) o = { band: 'Expected', pri: 'Low', expect: 'Derived — follows the component lines', note: '', action: '' };
      else if (p == null)
        o =
          absD >= th
            ? {
                band: 'Explain',
                pri: 'Medium',
                expect: 'Nil — no comparative balance',
                note: 'New line in the current year with no prior year comparative.',
                action: 'Agree the balance to supporting evidence and confirm the comparative presentation.'
              }
            : { band: 'Expected', pri: 'Low', expect: 'Nil — no comparative balance', note: '', action: '' };
      else if (absD >= th && n(absDev) >= investigatePct)
        o = {
          band: 'Investigate',
          pri: absD >= th * 8 ? 'High' : 'Medium',
          expect: `Tracking net assets (${gLabel}) = ${S}${fmt(Math.abs(n(exp)))}`,
          note: `The line moved ${pctLabel(pct)} against an expected ${gLabel} in line with net assets — ${S}${fmt(off)} away from expectation and above the ${S}${fmt(th)} review threshold.`,
          action: 'Obtain the administrator explanation and supporting analysis for the movement, and agree the drivers to source records.'
        };
      else if (absD >= th && n(absDev) >= explainPct)
        o = {
          band: 'Explain',
          pri: 'Low',
          expect: `Tracking net assets (${gLabel}) = ${S}${fmt(Math.abs(n(exp)))}`,
          note: `Movement of ${pctLabel(pct)} is ${S}${fmt(off)} away from expectation. Above the threshold in size but not in pattern.`,
          action: 'Confirm the driver in discussion with the administrator; no detailed testing proposed.'
        };
      else
        o = {
          band: 'Expected',
          pri: 'Low',
          expect: absP != null && absP < 10 ? 'Broadly flat' : `Tracking net assets (${gLabel})`,
          note: '',
          action: ''
        };
      // A note replaces the model's commentary; one drafted by Claude may keep or raise the band, never lower it.
      if (note)
        o = {
          band: note.aiDrafted && (BAND_RANK[note.band] ?? 0) < (BAND_RANK[o.band] ?? 0) ? o.band : note.band,
          pri: note.pri,
          expect: note.expect,
          note: note.note,
          action: note.action
        };
      if (mode === 'library' && !r.b && absD >= th && o.band === 'Expected')
        o = {
          ...o,
          band: 'Explain',
          note:
            o.note ||
            `Movement of ${S}${fmt(absD)} is at or above the ${S}${fmt(th)} review threshold, so it is listed for explanation under CHK-11.`,
          action: o.action || 'Obtain the administrator’s explanation for the movement and agree it to supporting evidence.'
        };
      const row: VarianceRow = { label: r.l, group: group.title, sub: !!r.b, cy: a, py: p, delta, pct, flag: r.flag || '', ...o };
      group.rows.push(row);
      rows.push(row);
    });
  });
  return { groups: groups.filter((g) => g.rows.length), rows };
}
