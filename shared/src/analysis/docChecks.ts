// Checks that work on the documents themselves rather than on single figures. No AI.
//   castAll      CHK-03  every subtotal and total in the statements and notes adds up (both years)
//   notesTieOut  CHK-04  every note total agrees to its line in the primary statements
//   scheduleToTb CHK-07  the investment schedule agrees to the trial balance
//   currency     CHK-14  amounts are stated in the presentation currency
//   staleDates   CHK-12  dates in the narrative belong to this year (approval date, reporting period)
import { statementLines, tbAccounts } from './tbMapping.js';
import type { Block, CastResult, Check, Doc, Docs, Setup } from './types.js';

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const NOT_WORDS = ['total', 'the', 'and', 'for', 'end', 'year', 'at'];
const words = (s: unknown): Set<string> =>
  new Set(
    String(s || '')
      .toLowerCase()
      .replace(/\bfvtpl\b/g, 'fair value through profit or loss')
      .replace(/\(?note \d+\)?/g, ' ')
      .replace(/[^a-z ]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !NOT_WORDS.includes(w))
      .map((w) => w.replace(/s$/, ''))
  );
const overlap = (a: unknown, b: unknown): number => {
  const A = words(a),
    B = words(b);
  const i = [...A].filter((w) => B.has(w)).length;
  return i / (Math.min(A.size, B.size) || 1);
};
const sections = (blocks: Block[] | null | undefined): { head: string; t: Block }[] => {
  const out: { head: string; t: Block }[] = [];
  let head = '';
  for (const b of blocks || []) {
    if (b.k === 'head') head = b.title || '';
    else if (b.k === 'table') out.push({ head, t: b });
  }
  return out;
};
const isPrimary = (h: string): boolean => /^(statement of|balance sheet|income statement)/i.test(h);
const yearCols = (t: Block): number[] =>
  (t.cols || []).map((c, i) => (/^(19|20)\d{2}$/.test(String(c).trim()) ? i : -1)).filter((i) => i >= 0);

// ---- CHK-03: every total adds up -------------------------------------------------------------
// A total equals the lines since the previous total, or the previous total plus those lines
// (running totals such as net operating profit). Net assets (assets less liabilities) is CHK-03's
// own net assets check. Tables with a Total column are also cast across.
export function castAll(cy: Doc | null | undefined, tol = 1): CastResult[] {
  const results: CastResult[] = [];
  for (const { head, t } of sections(cy?.blocks)) {
    const cols = yearCols(t).length ? yearCols(t) : (t.cols || []).map((_, i) => i);
    for (const ci of cols) {
      let since: number[] = [],
        prevTotal: number | null | undefined = null;
      for (const r of t.rows || []) {
        if (r.h) {
          since = [];
          prevTotal = null;
          continue;
        }
        const v = r.v?.[ci];
        if (r.dp || /per share|shares in issue/i.test(r.l || '')) continue;
        if (r.b) {
          if (/net assets attributable|^net assets$/i.test(r.l || '') && isPrimary(head)) {
            since = [];
            prevTotal = null;
            continue;
          }
          if (v != null && since.length) {
            const a = since.reduce((s, x) => s + x, 0),
              b = prevTotal != null ? prevTotal + a : null;
            const ok = Math.abs(a - v) <= tol || (b != null && Math.abs(b - v) <= tol);
            // a bold line straight after a single line that doesn't add up is a line, not a total
            // (e.g. "Increase in net assets from operations" within the movement in net assets)
            if (!ok && since.length === 1 && prevTotal == null) {
              since.push(v);
              continue;
            }
            results.push({
              where: `${head} · ${r.l}`,
              col: t.cols?.[ci] || '',
              stated: v,
              comp: ok ? v : b != null && Math.abs(b - v) < Math.abs(a - v) ? b : a,
              ok
            });
          }
          prevTotal = v;
          since = [];
          continue;
        }
        if (v != null) since.push(v);
      }
    }
    // across: Level 1 + Level 2 + Level 3 = Total
    const ti = (t.cols || []).findIndex((c) => /^total$/i.test(String(c).trim()));
    if (ti > 0)
      for (const r of t.rows || []) {
        if (!r.v || r.v[ti] == null) continue;
        const total = r.v[ti] as number;
        const a = r.v.slice(0, ti).reduce<number>((s, x) => s + (x || 0), 0);
        results.push({ where: `${head} · ${r.l} (across)`, col: 'Total', stated: total, comp: a, ok: Math.abs(a - total) <= tol });
      }
  }
  return results;
}

// ---- CHK-04: note totals agree to the statements ---------------------------------------------
export interface NoteTie {
  note: string;
  total: string;
  line: string;
  stated: number;
  comp: number;
  ok: boolean;
}
export function notesTieOut(cy: Doc | null | undefined, tol = 1): NoteTie[] {
  const secs = sections(cy?.blocks),
    lines: { head: string; label: string; ref: string; v: number }[] = [];
  for (const { head, t } of secs.filter((s) => isPrimary(s.head))) {
    const ci = yearCols(t)[0] ?? 0;
    for (const r of t.rows || []) if (!r.h && r.v?.[ci] != null) lines.push({ head, label: r.l, ref: r.ref || '', v: r.v[ci] as number });
  }
  const results: NoteTie[] = [];
  for (const { head, t } of secs.filter((s) => !isPrimary(s.head) && /^(\d{1,2}\.|note \d)/i.test(s.head))) {
    const num = head.match(/^(?:note\s*)?(\d{1,2})/i)?.[1];
    const ci = yearCols(t)[0] ?? 0;
    const totals = (t.rows || []).filter(
      (r) => r.b && r.v?.[ci] != null && /^total|at the end of the year|in issue at the end/i.test(r.l || '')
    );
    for (const r of totals) {
      const value = r.v![ci] as number;
      // the statement line that refers to this note, else the one whose wording matches best
      const byRef = num ? lines.filter((l) => new RegExp(`note ${num}\\b`, 'i').test(`${l.label} ${l.ref}`)) : [];
      const cands = (byRef.length ? byRef : lines)
        .map((l) => ({ l, s: Math.max(overlap(r.l, l.label), overlap(head, l.label)) }))
        .sort((a, b) => b.s - a.s);
      const best = cands[0];
      if (!best || (best.s < 0.6 && !byRef.length)) continue;
      const ok = Math.abs(Math.abs(best.l.v) - Math.abs(value)) <= tol;
      results.push({
        note: head,
        total: r.l,
        line: `${best.l.head} · ${best.l.label}`,
        stated: Math.abs(best.l.v),
        comp: Math.abs(value),
        ok
      });
    }
  }
  return results;
}

// ---- CHK-07: investment schedule to the trial balance ----------------------------------------
export function scheduleToTb(
  docs: Docs | null | undefined,
  tbMap: Record<string, string> = {}
): { schedule: number; ledger: number; accounts: string[]; how: string } | null {
  const sched = docs?.is,
    tb = docs?.tb;
  if (!sched || !tb) return null;
  const total = (() => {
    for (const b of sched.blocks || [])
      if (b.k === 'table') {
        const t = (b.rows || []).find((r) => r.b && /total/i.test(r.l || ''));
        if (t?.v?.[0] != null) return t.v[0];
      }
    return null;
  })();
  if (total == null) return null;
  const accounts = tbAccounts(tb),
    lines = statementLines(docs.cy);
  const fvLine = lines.find((l) => /fair value|investments/i.test(l.label) && l.side === 'dr');
  let picked = fvLine ? accounts.filter((a) => tbMap[a.code] === fvLine.key) : [];
  let how = 'accounts mapped to the investments line';
  if (!picked.length) {
    picked = accounts.filter((a) => /fair value|fvtpl|investments? (at|held)|financial assets/i.test(a.name) && a.bal > 0);
    how = 'investment accounts found by name';
  }
  if (!picked.length) return null;
  const ledger = picked.reduce((s, a) => s + a.bal, 0);
  return { schedule: total, ledger, accounts: picked.map((a) => a.code), how };
}

// ---- CHK-14: presentation currency ------------------------------------------------------------
const CCY: Record<string, string> = { '£': 'GBP', '€': 'EUR', $: 'USD' };
export interface CurrencyUse {
  ccy: string;
  text: string;
  at?: number;
  context: string;
}
export function currency(
  cy: Doc | null | undefined,
  expected: string | null = null
): { declared: string | null | undefined; others: CurrencyUse[] } {
  const texts: string[] = [];
  for (const b of cy?.blocks || []) {
    if (b.k === 'para') texts.push(b.text as string);
    if (b.k === 'head') texts.push(`${b.title} ${b.sub || ''}`);
    if (b.k === 'table') (b.rows || []).forEach((r) => texts.push(r.l || ''));
  }
  const all = texts.join(' \n ');
  const declared =
    all.match(/presented in [a-z ]*\(?\b(GBP|EUR|USD|CHF|JPY)\b\)?/i)?.[1]?.toUpperCase() ||
    all.match(/presentation currency[^.]{0,60}\b(GBP|EUR|USD|CHF|JPY)\b/i)?.[1]?.toUpperCase();
  const uses = [...all.matchAll(/(?:\b(GBP|EUR|USD|CHF|JPY)\s?(?=\d)|([£€$])\s?(?=\d))[\d.,]+/g)].map((m) => ({
    ccy: (m[1] || CCY[m[2] as string]!).toUpperCase(),
    text: m[0],
    at: m.index as number
  }));
  // the fund's own presentation currency wins; the accounts must not declare a different one
  const mismatch: CurrencyUse | null =
    expected && declared && declared !== expected
      ? {
          ccy: declared,
          text: `presented in ${declared}`,
          context: `The accounts say they are presented in ${declared}, but this fund’s presentation currency is ${expected}`
        }
      : null;
  if (!uses.length) return { declared: expected || declared, others: mismatch ? [mismatch] : [] };
  const counts = uses.reduce<Record<string, number>>((a, u) => ({ ...a, [u.ccy]: (a[u.ccy] || 0) + 1 }), {});
  const main = expected || declared || Object.entries(counts).sort((a, b) => b[1] - a[1])[0]![0];
  const others = uses
    .filter((u) => u.ccy !== main)
    .map((u) => ({
      ...u,
      context: all
        .slice(Math.max(0, u.at - 60), u.at + 40)
        .replace(/\s+/g, ' ')
        .trim()
    }));
  return { declared: main, others: mismatch ? [mismatch, ...others] : others };
}

// ---- CHK-12: dates belonging to another year --------------------------------------------------
const toIso = (d: string, m: string, y: string): string =>
  `${y}-${String(MONTHS.indexOf(m.toLowerCase()) + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
export interface StaleDate {
  kind: 'approval' | 'period';
  date: string;
  why: string;
  context: string;
}
export function staleDates(cy: Doc | null | undefined, yearEnd: string | null | undefined): StaleDate[] {
  if (!yearEnd) return [];
  const paras = (cy?.blocks || []).filter((b) => b.k === 'para').map((b) => b.text as string),
    found: StaleDate[] = [];
  const D = `(\\d{1,2})(?:st|nd|rd|th)? (${MONTHS.join('|')}) (\\d{4})`;
  for (const p of paras) {
    const fyStart = `${+yearEnd.slice(0, 4) - 1}${yearEnd.slice(4)}`;
    for (const m of p.matchAll(new RegExp(`approved by the (?:board|directors)[^.]{0,60}? on ${D}`, 'gi'))) {
      const [, d, mo, y] = m as unknown as [string, string, string, string];
      const iso = toIso(d, mo, y),
        before = p.slice(Math.max(0, (m.index as number) - 90), m.index);
      const ofAccounts = /financial statements/i.test(before + m[0]);
      if (ofAccounts && iso <= yearEnd)
        found.push({
          kind: 'approval',
          date: `${d} ${mo} ${y}`,
          why: `the financial statements can’t have been approved on or before the year end (${yearEnd}); it looks carried forward from last year`,
          context: m[0]
        });
      else if (!ofAccounts && iso <= fyStart)
        found.push({
          kind: 'approval',
          date: `${d} ${mo} ${y}`,
          why: 'this approval is dated before this financial year began; check the wording hasn’t been carried forward from last year',
          context: m[0]
        });
    }
    for (const m of p.matchAll(new RegExp(`(?:for the|in the) (?:year|period) ended ${D}`, 'gi'))) {
      const [, d, mo, y] = m as unknown as [string, string, string, string];
      const iso = toIso(d, mo, y);
      if (
        iso !== yearEnd &&
        iso.slice(5) === yearEnd.slice(5) &&
        +y === +yearEnd.slice(0, 4) - 1 &&
        !/prior|previous|comparative|2024|last year/i.test(p.slice(Math.max(0, (m.index as number) - 40), m.index))
      )
        found.push({ kind: 'period', date: `${d} ${mo} ${y}`, why: 'this refers to last year’s reporting period', context: m[0] });
    }
  }
  return found;
}

// ---- rows for the checks table ---------------------------------------------------------------
type Base = Pick<Check, 'id' | 'rule' | 'name' | 'area' | 'refs' | 'follow' | 'anchor'> & { count?: boolean };
type Outcome = Pick<Check, 'comp' | 'stated' | 'diff' | 'result' | 'detail'>;
const row = (base: Base, outcome: Outcome): Check => ({ ...base, ...outcome }) as Check;

export function docCheckRows(docs: Docs | null | undefined, setup: Setup, ruleOn: (setup: Setup, id: string) => boolean): Check[] {
  const out: Check[] = [],
    tolOf = (id: string): number => {
      const r = setup?.rules?.[id] || {};
      return r.tol ?? 1;
    };
  const cy = docs?.cy;
  if (cy && ruleOn(setup, 'CHK-03')) {
    const r = castAll(cy, tolOf('CHK-03')),
      bad = r.filter((x) => !x.ok),
      f = bad[0];
    out.push(
      row(
        {
          id: 'castall',
          rule: 'CHK-03',
          name: 'Every subtotal and total casts',
          area: 'Primary statements',
          refs: 'Statements and notes',
          follow: 'Obtain a recast of the statement or note and agree each line to the trial balance.',
          anchor: f?.where.split(' · ').pop() || ''
        },
        r.length
          ? f
            ? {
                comp: f.comp,
                stated: f.stated,
                diff: f.stated - f.comp,
                result: 'Difference',
                detail: `${r.length} totals recast; ${bad.length} ${bad.length === 1 ? 'does' : 'do'} not add up, first is ${f.where}${f.col ? ` (${f.col})` : ''}`
              }
            : {
                comp: null,
                stated: null,
                diff: 0,
                result: 'Agrees',
                detail: `All ${r.length} subtotals and totals in the statements and notes add up`
              }
          : { comp: null, stated: null, diff: null, result: 'Not tested', detail: 'No totals found to recast' }
      )
    );
  }
  if (cy?.umbrellaCast?.length && ruleOn(setup, 'CHK-03')) {
    const r = cy.umbrellaCast,
      bad = r.filter((x) => !x.ok),
      f = bad[0];
    out.push(
      row(
        {
          id: 'umbcast',
          rule: 'CHK-03',
          name: 'Sub-funds add up to the umbrella totals',
          area: 'Primary statements',
          refs: 'Umbrella statements',
          anchor: f?.where || '',
          follow: 'Correct the umbrella total column, or the sub-fund column that is wrong.'
        },
        f
          ? {
              comp: f.comp,
              stated: f.stated,
              diff: f.stated - f.comp,
              result: 'Difference',
              detail: `${r.length} umbrella totals checked; ${bad.length} ${bad.length === 1 ? 'does' : 'do'} not equal the sum of the sub-funds, first is ${f.where} (${f.col})`
            }
          : {
              comp: null,
              stated: null,
              diff: 0,
              result: 'Agrees',
              detail: `All ${r.length} umbrella totals equal the sum of the sub-fund columns`
            }
      )
    );
  }
  if (cy && ruleOn(setup, 'CHK-04')) {
    const r = notesTieOut(cy, tolOf('CHK-04')),
      bad = r.filter((x) => !x.ok),
      f = bad[0];
    out.push(
      row(
        {
          id: 'notes',
          rule: 'CHK-04',
          name: 'Note totals agree to the statements',
          area: 'Notes',
          refs: f ? `${f.note} · ${f.line}` : 'Notes · Statements',
          follow: 'Agree the note to the statement line and correct whichever is wrong.',
          anchor: f?.total || ''
        },
        r.length
          ? f
            ? {
                comp: f.comp,
                stated: f.stated,
                diff: f.stated - f.comp,
                result: 'Difference',
                detail: `${r.length} note totals tied; ${bad.length} ${bad.length === 1 ? 'differs' : 'differ'}, first is ${f.note}: ${f.total} against ${f.line}`
              }
            : { comp: null, stated: null, diff: 0, result: 'Agrees', detail: `All ${r.length} note totals agree to the statements` }
          : { comp: null, stated: null, diff: null, result: 'Not tested', detail: 'No note totals could be matched to a statement line' }
      )
    );
  }
  if (ruleOn(setup, 'CHK-07')) {
    const r = scheduleToTb(docs, setup?.tbMap || {}),
      tol = tolOf('CHK-07');
    out.push(
      row(
        {
          id: 'tbinv',
          rule: 'CHK-07',
          name: 'Investment schedule agrees to the trial balance',
          area: 'Investments',
          refs: 'Investment schedule · Trial balance',
          anchor: 'Total investments at fair value',
          follow: 'Reconcile the custodian valuation to the ledger and agree the difference to its cause.'
        },
        r
          ? {
              comp: r.schedule,
              stated: r.ledger,
              diff: r.ledger - r.schedule,
              result: Math.abs(r.ledger - r.schedule) <= tol ? 'Agrees' : 'Difference',
              detail: `Schedule total against ${r.how} (${r.accounts.join(', ')})`
            }
          : {
              comp: null,
              stated: null,
              diff: null,
              result: 'Not tested',
              detail: 'Schedule total or trial balance investment accounts not available'
            }
      )
    );
  }
  if (cy && ruleOn(setup, 'CHK-14')) {
    const r = currency(cy, (setup?.fund?.currency as string) || null),
      f = r.others[0];
    out.push(
      row(
        {
          id: 'ccy',
          rule: 'CHK-14',
          count: true,
          name: 'Amounts are in the presentation currency',
          area: 'Presentation',
          refs: 'Notes',
          anchor: f?.text || '',
          follow: 'Restate the amounts in the presentation currency, or label any foreign currency amount clearly with its conversion.'
        },
        {
          comp: null,
          stated: null,
          diff: r.others.length ? r.others.length : 0,
          result: r.others.length ? 'Difference' : 'Agrees',
          detail: r.others.length
            ? `${r.others.length} amount${r.others.length === 1 ? '' : 's'} in ${[...new Set(r.others.map((o) => o.ccy))].join(', ')} in ${r.declared} accounts, first: “…${f!.context}…”`
            : `All amounts with a currency are in ${r.declared || 'one currency'}`
        }
      )
    );
  }
  if (cy && ruleOn(setup, 'CHK-12')) {
    const r = staleDates(cy, setup?.fund?.yearEnd),
      f = r[0];
    out.push(
      row(
        {
          id: 'dates',
          rule: 'CHK-12',
          count: true,
          name: 'Dates in the narrative belong to this year',
          area: 'Narrative',
          refs: 'Notes',
          anchor: f?.context || '',
          follow: 'Update the date, or confirm it is correct and explain it.'
        },
        {
          comp: null,
          stated: null,
          diff: r.length,
          result: r.length ? 'Difference' : 'Agrees',
          detail: r.length
            ? `${r.length} date${r.length === 1 ? '' : 's'} from another year, first: ${f!.date}: ${f!.why}`
            : 'No approval or reporting-period dates from another year found'
        }
      )
    );
  }
  return out;
}
