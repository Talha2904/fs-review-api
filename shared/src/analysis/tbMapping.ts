// CHK-02, trial balance to statements. Each trial balance account is mapped to one line of the
// primary statements; the check adds up the mapped balances (debits minus credits) for every line and
// compares them with the amount in the draft, and lists accounts with a balance that are not mapped.
// No AI: the suggestion is a name-matching rule and a person confirms the mapping.
import type { Doc, Docs } from './types.js';

// Common abbreviations in ledger account names, expanded so they match statement wording.
const ABBREV: [RegExp, string][] = [
  [/\bfvtpl\b/g, 'fair value through profit or loss'],
  [/\bfvoci\b/g, 'fair value through other comprehensive income'],
  [/\bnav\b/g, 'net asset value'],
  [/\bwht\b/g, 'withholding tax'],
  [/\bmgmt\b/g, 'management'],
  [/\badmin\b/g, 'administration'],
  [/\brec(eiv)?\b/g, 'receivable'],
  [/\bpay\b/g, 'payable'],
  [/\binv(est)?\b/g, 'investment'],
  [/\bunreal(i[sz]ed)?\b/g, 'unrealised'],
  [/\breal(i[sz]ed)?\b/g, 'realised'],
  [/\bdiv(s)?\b/g, 'dividend'],
  [/\bint\b/g, 'interest'],
  [/\bb\/f\b/g, 'brought forward']
];
const STOP = new Set([
  'the',
  'and',
  'for',
  'from',
  'with',
  'gbp',
  'eur',
  'usd',
  'account',
  'operating',
  'at',
  'bank',
  'year',
  'note',
  'total'
]);
const expand = (s: unknown): string => ABBREV.reduce((t, [re, w]) => t.replace(re, w), String(s || '').toLowerCase());
const words = (s: unknown): string[] =>
  expand(s)
    .replace(/[—–-]/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w))
    .map((w) => w.replace(/s$/, ''));

export interface TbAccount {
  code: string;
  name: string;
  dr: number;
  cr: number;
  bal: number;
}

export interface StatementLine {
  key: string;
  statement: string;
  label: string;
  amount: number;
  side: 'dr' | 'cr';
}

/** Trial balance accounts: rows with an account code and Debit/Credit values. */
export function tbAccounts(tbDoc: Doc | null | undefined): TbAccount[] {
  const out: TbAccount[] = [];
  for (const b of tbDoc?.blocks || []) {
    if (b.k !== 'table') continue;
    const cols = b.cols!;
    const di = cols.findIndex((c) => /debit/i.test(c)),
      ci = cols.findIndex((c) => /credit/i.test(c));
    if (di < 0 || ci < 0) continue;
    for (const r of b.rows || []) {
      if (r.h || r.b || /^total/i.test(r.l || '')) continue;
      const dr = Number(r.v?.[di]) || 0,
        cr = Number(r.v?.[ci]) || 0;
      out.push({ code: String(r.ref || r.l), name: r.l, dr, cr, bal: dr - cr });
    }
  }
  return out;
}

/** Lines of the primary statements ("Statement of…", "Balance sheet" or "Income statement") that carry an amount. */
export function statementLines(cyDoc: Doc | null | undefined): StatementLine[] {
  // side: the ledger side a line's accounts normally sit on. Balance sheet assets and lines shown as
  // negative (expenses, tax, redemptions) are debits; liabilities and positive results lines are credits.
  const out: StatementLine[] = [];
  let head = '';
  for (const b of cyDoc?.blocks || []) {
    if (b.k === 'head') {
      head = /^(statement of|balance sheet|income statement)/i.test(b.title || '') ? (b.title as string) : ''; // notes are not primary statements
      continue;
    }
    if (b.k !== 'table' || !head) continue;
    const balanceSheet = /financial position|balance sheet/i.test(head) && !/changes/i.test(head);
    let liab = /liabilit/i.test(b.label || '');
    for (const r of b.rows || []) {
      if (r.h) {
        liab = /liabilit|equity|net assets/i.test(r.l || '');
        continue;
      }
      const v = Number(r.v?.[0]);
      if (r.b || r.dp || !Number.isFinite(v) || r.v?.[0] == null) continue;
      if (/per share|shares in issue|^total/i.test(r.l || '')) continue;
      const side = balanceSheet ? (liab ? 'cr' : 'dr') : v < 0 ? 'dr' : 'cr';
      out.push({ key: `${head}|${r.l}`, statement: head, label: r.l, amount: v, side });
    }
  }
  return out;
}

/**
 * Suggests a line for each account by matching words in the names; fee, cost and expense accounts go
 * to the expenses line when the statement shows expenses in one line. Returns { code: lineKey }.
 */
export function suggestMapping(
  accounts: TbAccount[],
  lines: StatementLine[],
  existing: Record<string, string> = {}
): Record<string, string> {
  const expensesLine = lines.find((l) => /expenses/i.test(l.label));
  const out = { ...existing };
  for (const a of accounts) {
    if (out[a.code]) continue;
    const aw = new Set(words(a.name));
    let best: StatementLine | null = null,
      score = 0;
    const side = a.bal > 0 ? 'dr' : a.bal < 0 ? 'cr' : null;
    // score: shared words over all words; cover: how much of the account's own name the line contains
    let bestCover: StatementLine | null = null,
      cover = 0;
    for (const l of lines.filter((l) => !side || l.side === side)) {
      const lw = new Set(words(l.label));
      const inter = [...aw].filter((w) => lw.has(w)).length;
      const s = inter / (aw.size + lw.size - inter || 1),
        c = inter >= 2 ? inter / (aw.size || 1) : 0;
      if (s > score) {
        score = s;
        best = l;
      }
      if (c > cover) {
        cover = c;
        bestCover = l;
      }
    }
    if (best && score >= 0.3) out[a.code] = best.key;
    else if (bestCover && cover >= 0.6) out[a.code] = bestCover.key;
    else if (/cash/i.test(a.name)) {
      const c = lines.find((l) => /cash/i.test(l.label) && (!side || l.side === side));
      if (c) out[a.code] = c.key;
    } else if (/brought forward|opening|beginning/i.test(a.name)) {
      const c = lines.find((l) => /beginning|opening/i.test(l.label));
      if (c) out[a.code] = c.key;
    } else if (expensesLine && /fee|cost|expense|charge/i.test(a.name) && a.bal > 0) out[a.code] = expensesLine.key;
  }
  return out;
}

export interface MappedLine extends StatementLine {
  accounts: TbAccount[];
  tb: number;
}
export interface MappingResult {
  accounts: TbAccount[];
  lines: StatementLine[];
  results: (MappedLine & { diff: number; ok: boolean })[];
  unmapped: TbAccount[];
  notCovered: StatementLine[];
  stale: TbAccount[];
  mappedCount: number;
}

/**
 * The check. A line's mapped accounts are netted (debits minus credits) and turned into the line's own
 * side, so an account whose balance sits on the wrong side shows as a difference.
 */
export function checkTbMapping(docs: Docs | null | undefined, map: Record<string, string> = {}, tol = 1): MappingResult {
  const accounts = tbAccounts(docs?.tb),
    lines = statementLines(docs?.cy);
  const byKey: Record<string, MappedLine> = Object.fromEntries(lines.map((l) => [l.key, { ...l, accounts: [], tb: 0 }]));
  const unmapped: TbAccount[] = [],
    stale: TbAccount[] = [];
  for (const a of accounts) {
    const k = map[a.code];
    const line = k ? byKey[k] : undefined;
    if (line) {
      line.accounts.push(a);
      line.tb += a.bal;
    } else {
      if (k) stale.push(a);
      if (Math.round(a.bal) !== 0) unmapped.push(a);
    }
  }
  const results = Object.values(byKey)
    .filter((l) => l.accounts.length)
    .map((l) => {
      const onSide = l.side === 'dr' ? l.tb : -l.tb;
      const diff = Math.abs(l.amount) - onSide;
      return { ...l, diff, ok: Math.abs(diff) <= tol };
    });
  const notCovered = lines.filter((l) => !byKey[l.key]!.accounts.length);
  return {
    accounts,
    lines,
    results,
    unmapped,
    notCovered,
    stale,
    mappedCount: accounts.filter((a) => {
      const k = map[a.code];
      return k && byKey[k];
    }).length
  };
}
