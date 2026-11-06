// The Consolidated Review across related entities (every fund of every entity with the same Client name and
// year end). Pure and deterministic: it reads each fund's saved analysis, picks out the balances and notes
// that involve another member of the group, pairs what it can match by name and amount, and groups review
// points that recur across funds. What needs judgement (a counterparty named by role, "the manager", or two
// findings worded differently) is left for the AI step, which only ever sees the compact candidates built
// here, never the documents. The app always does the arithmetic: amounts and differences come from this file.
import { statementLines } from './tbMapping.js';
import type { AnalysisResult, Doc } from './types.js';

/** One fund in the group, with its latest saved analysis. */
export interface GroupMember {
  engagementId: string;
  fundName: string;
  entityName: string;
  entityType?: string | undefined;
  currency: string;
  /** the fund's latest analysis; null when it has not been analysed */
  result: AnalysisResult | null;
  /** whether the client permits AI, so whether this fund's lines may be sent to Claude */
  aiAllowed: boolean;
}

/** A current review point of a fund, as the group sees it. */
export interface MemberPoint {
  engagementId: string;
  ref: string;
  title: string;
  area?: string | undefined;
  rule?: string | undefined;
  kind?: string | undefined;
  status: string;
}

export type LinkSide = 'receivable' | 'payable' | 'flow';

/** A balance or note line that may involve another member of the group. */
export interface LinkCandidate {
  /** stable within one review: "<engagementId>#<n>" */
  id: string;
  engagementId: string;
  fundName: string;
  /** where it was found: a statement title or a note heading */
  where: string;
  label: string;
  amount: number | null;
  currency: string;
  /** receivable / asset owed to this fund; payable / liability owed by it; flow = a charge or income in the year */
  side: LinkSide;
  /** members (engagementIds) this line names */
  mentions: string[];
}

export type LinkStatus = 'agrees' | 'differs' | 'different-currency' | 'no-amount';

/** Two lines that describe the same balance from each side. */
export interface InterLink {
  a: LinkCandidate;
  b: LinkCandidate;
  status: LinkStatus;
  /** a.amount − b.amount, in their (shared) currency; null when not comparable */
  difference: number | null;
  matchedBy: 'app' | 'ai';
  relationship?: string | undefined;
  note?: string | undefined;
}

/** Review points that are the same matter in two or more funds. */
export interface PointGroup {
  key: string;
  title: string;
  points: { engagementId: string; fundName: string; ref: string; title: string; status: string }[];
  matchedBy: 'app' | 'ai';
}

export interface ConsolidationResult {
  members: { engagementId: string; fundName: string; entityName: string; currency: string; analysed: boolean; aiAllowed: boolean }[];
  links: InterLink[];
  /** candidate lines that name another member but have no matching line in that member */
  unmatched: LinkCandidate[];
  groups: PointGroup[];
  summary: string;
}

// ---- names ----------------------------------------------------------------------------------------------

const LEGAL = new Set([
  'limited',
  'ltd',
  'lp',
  'llp',
  'llc',
  'inc',
  'plc',
  'sa',
  'sarl',
  'icav',
  'sicav',
  'fund',
  'funds',
  'the',
  'and',
  'of',
  'co',
  'company',
  'group'
]);
const tokens = (s: unknown): string[] =>
  String(s ?? '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    // single characters say nothing, except a digit or a roman numeral that numbers a fund ("Fund 2", "Fund I")
    .filter((w) => (w.length > 1 || /^[0-9iv]$/.test(w)) && !LEGAL.has(w));

/** The key that groups entities: their Client name, else their own name; case and spacing ignored. */
export const groupKeyOf = (client: unknown, entityName: unknown): string =>
  String(client || entityName || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/**
 * The words that tell each member apart from the rest of the group (words every member shares, such as the
 * group's own name, say nothing about which member is meant). A line names a member when it contains all
 * of that member's distinctive words from either its entity name or its fund name.
 */
export function memberNames(members: Pick<GroupMember, 'engagementId' | 'fundName' | 'entityName'>[]): Map<string, string[][]> {
  const fallback = new Set<string>();
  const sets = members.map((m) => [tokens(m.entityName), tokens(m.fundName)]);
  const everywhere = new Set([...new Set(sets.flat(2))].filter((w) => sets.every((names) => names.some((n) => n.includes(w)))));
  // A fund's number ("I", "II", "2") is needed only when it alone tells two members apart: "Due from Alderwick
  // Direct Lending" still names Direct Lending I, but ABC Fund I and ABC Fund II are told apart by "I" and "II"
  // (together with the group's words, so a stray "2" in a sentence names nothing).
  const distinct = sets.map((alts) => alts.map((n) => [...new Set(n.filter((w) => !everywhere.has(w)))]));
  const coreOf = (d: string[]) => d.filter((w) => !NUMERAL.test(w));
  const cores = distinct.map((alts) => alts.map((d) => coreOf(d).sort().join(' ')).filter(Boolean));
  const out = new Map<string, string[][]>();
  members.forEach((m, i) => {
    const names = distinct[i]!.flatMap((d, k) => {
      if (!d.length) return [];
      const core = coreOf(d);
      const key = core.slice().sort().join(' ');
      const unique = !!core.length && !cores.some((c, j) => j !== i && c.includes(key));
      return [unique ? core : [...new Set(sets[i]![k]!)]];
    });
    // a member named only by the group's shared words ("ABC Fund" among ABC entities) is recognised by its full name
    if (!names.length) fallback.add(m.engagementId);
    out.set(m.engagementId, names.length ? names : sets[i]!.filter((n) => n.length).map((n) => [...new Set(n)]));
  });
  FALLBACK.set(out, fallback);
  return out;
}

const NUMERAL = /^(\d+|[ivx]+)$/;

/** Members recognised only by the group's shared words: they lose to any member a line names more precisely. */
const FALLBACK = new WeakMap<Map<string, string[][]>, Set<string>>();

const names = (text: string, self: string, known: Map<string, string[][]>): string[] => {
  const words = new Set(tokens(text));
  const hit = [...known.entries()]
    .filter(([id, alts]) => id !== self && alts.some((alt) => alt.every((w) => words.has(w))))
    .map(([id]) => id);
  // "Amounts due to ABC Property" names ABC Property, not also the member called just "ABC Fund"
  const weak = FALLBACK.get(known) ?? new Set<string>();
  const strong = hit.filter((id) => !weak.has(id));
  return strong.length ? strong : hit;
};

// ---- candidates -----------------------------------------------------------------------------------------

/** Words that mark a balance or note line as involving a related or connected party. */
const RELATED =
  /\b(due (from|to)|amounts? (owed|due)|owed (by|to)|intercompan|inter-?company|related[- ]part|connected|group compan|loans? (to|from) (related|group|connected|the manager|parent|subsidiar|associate)|receivable from|payable to|parent|subsidiar|associate|manager|general partner|management fee|advisory fee|carried interest|performance fee)/i;
const PAYABLE = /\b(payable|due to|owed to|owing to|accrued|accrual|outstanding|loan from|borrowing|creditor)/i;
const RECEIVABLE = /\b(receivable|due from|owed by|owing from|outstanding from|loan to|debtor|prepa|accrued income)/i;
const NOTE_HEAD = /related[- ]part|intercompan|connected[- ]part|group (balances|transactions)/i;

// The wording decides the side ("receivable", "due to", "accrued income"), receivable wording first; on the balance
// sheet, a line without such wording takes the side it sits on (where the extracted table marks its liabilities).
const sideOf = (label: string, ledgerSide?: 'dr' | 'cr', balanceSheet = false): LinkSide => {
  if (RECEIVABLE.test(label)) return 'receivable';
  if (PAYABLE.test(label)) return 'payable';
  if (balanceSheet && ledgerSide) return ledgerSide === 'dr' ? 'receivable' : 'payable';
  return 'flow';
};

/** The current-year figure only: a blank current year is no amount, never the comparative. */
const currentYear = (v: (number | null)[] | undefined): number | null => {
  const x = v?.[0];
  return typeof x === 'number' && Number.isFinite(x) ? x : null;
};

/** An amount written in a sentence: with thousands separators, a currency sign, or five or more digits; never a year. */
export function amountIn(sentence: string): number | null {
  for (const m of sentence.matchAll(/([£$€]\s?)?(\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/g)) {
    const digits = m[2]!;
    if (m[1] || digits.includes(',') || digits.length >= 5) return Number(digits.replace(/,/g, ''));
  }
  return null;
}

/** Balance-sheet lines and related-party note lines of one fund's current-year draft. */
export function linkCandidates(member: GroupMember, known: Map<string, string[][]>): LinkCandidate[] {
  const cy: Doc | undefined = member.result?.docs?.cy;
  if (!cy) return [];
  const out: LinkCandidate[] = [];
  const add = (where: string, label: string, amount: number | null, side: LinkSide, extra = '') => {
    const mentions = names(`${label} ${extra}`, member.engagementId, known);
    if (!RELATED.test(label) && !mentions.length) return;
    if (out.some((c) => c.where === where && c.label === label)) return;
    out.push({
      id: `${member.engagementId}#${out.length + 1}`,
      engagementId: member.engagementId,
      fundName: member.fundName,
      where,
      label,
      amount,
      currency: member.currency,
      side,
      mentions
    });
  };
  // 1. the primary statements (balance sheet sides come from where the line sits)
  for (const l of statementLines(cy)) {
    const bs = /financial position|balance sheet/i.test(l.statement) && !/changes/i.test(l.statement);
    if (!bs) continue;
    add(l.statement, l.label, l.amount, sideOf(l.label, l.side, true));
  }
  // 2. related-party / intercompany notes: their table rows, and amounts written into their paragraphs
  let inNote = '';
  for (const b of cy.blocks || []) {
    if (b.k === 'head') {
      inNote = NOTE_HEAD.test(b.title || '') ? String(b.title) : '';
      continue;
    }
    if (!inNote) continue;
    if (b.k === 'table')
      for (const r of b.rows || []) {
        if (r.h || r.b || !r.l) continue;
        add(inNote, r.l, currentYear(r.v), sideOf(r.l));
      }
    else if (b.k === 'para' && b.text) {
      // a sentence that names another member is kept even without an amount, so the AI can pair it
      for (const sentence of String(b.text).split(/(?<=[.;])\s+/)) {
        const amt = amountIn(sentence);
        if (names(sentence, member.engagementId, known).length || (amt != null && RELATED.test(sentence)))
          add(inNote, sentence.trim().slice(0, 240), amt, sideOf(sentence));
      }
    }
  }
  return out;
}

// ---- matching -------------------------------------------------------------------------------------------

/** Compares the two sides of a link; the tolerance is in currency units. */
export function compareLink(a: LinkCandidate, b: LinkCandidate, tol = 1): { status: LinkStatus; difference: number | null } {
  if (a.amount == null || b.amount == null) return { status: 'no-amount', difference: null };
  if (a.currency !== b.currency) return { status: 'different-currency', difference: null };
  const difference = Math.abs(a.amount) - Math.abs(b.amount);
  return { status: Math.abs(difference) <= tol ? 'agrees' : 'differs', difference };
}

const opposite = (a: LinkSide, b: LinkSide) => (a === 'receivable' && b === 'payable') || (a === 'payable' && b === 'receivable');

/**
 * Pairs lines that name each other: A's receivable naming B with B's payable naming A (or the reverse).
 * Where one line has several possible partners the closest amount wins. Each line is used once.
 */
export function matchByName(cands: LinkCandidate[], tol = 1): InterLink[] {
  const used = new Set<string>();
  const links: InterLink[] = [];
  for (const a of cands) {
    if (used.has(a.id) || a.side === 'flow') continue;
    const options = cands.filter(
      (b) =>
        !used.has(b.id) &&
        b.engagementId !== a.engagementId &&
        opposite(a.side, b.side) &&
        a.mentions.includes(b.engagementId) &&
        b.mentions.includes(a.engagementId)
    );
    if (!options.length) continue;
    const gap = (b: LinkCandidate) => (a.amount == null || b.amount == null ? Infinity : Math.abs(Math.abs(a.amount) - Math.abs(b.amount)));
    const b = options.slice().sort((x, y) => gap(x) - gap(y))[0]!;
    used.add(a.id).add(b.id);
    links.push({ a, b, ...compareLink(a, b, tol), matchedBy: 'app' });
  }
  return links;
}

// ---- common review points -------------------------------------------------------------------------------

const titleKey = (t: string) => tokens(t.replace(/[\d,.]+/g, ' ')).join(' ');

/**
 * Open points that are the same matter in two or more funds: the same check (CHK-xx), or the same title once
 * amounts and punctuation are ignored. Cleared points are left out: they need nothing further.
 */
export function groupCommonPoints(points: MemberPoint[], fundName: (id: string) => string): { groups: PointGroup[]; rest: MemberPoint[] } {
  const open = points.filter((p) => p.status !== 'cleared');
  const byKey = new Map<string, MemberPoint[]>();
  for (const p of open) {
    const key = p.rule ? `rule:${p.rule}` : `title:${titleKey(p.title)}`;
    if (key === 'title:') continue;
    byKey.set(key, [...(byKey.get(key) || []), p]);
  }
  const groups: PointGroup[] = [];
  const grouped = new Set<MemberPoint>();
  for (const [key, ps] of byKey) {
    if (new Set(ps.map((p) => p.engagementId)).size < 2) continue;
    ps.forEach((p) => grouped.add(p));
    groups.push({
      key,
      title: ps[0]!.title,
      points: ps.map((p) => ({
        engagementId: p.engagementId,
        fundName: fundName(p.engagementId),
        ref: p.ref,
        title: p.title,
        status: p.status
      })),
      matchedBy: 'app'
    });
  }
  return { groups, rest: open.filter((p) => !grouped.has(p)) };
}

// ---- AI input and answer --------------------------------------------------------------------------------

/** What the AI step is given: only funds whose client permits AI, and only lines and titles, never documents. */
export interface ConsolidationAiInput {
  members: { id: string; fund: string; entity: string; type: string }[];
  lines: { id: string; fund: string; where: string; label: string; amount: number | null; currency: string; side: LinkSide }[];
  points: { fund: string; ref: string; title: string; area: string; kind: string }[];
}

export interface ConsolidationAiAnswer {
  pairs?: { a?: unknown; b?: unknown; relationship?: unknown; note?: unknown }[];
  groups?: { title?: unknown; points?: { fund?: unknown; ref?: unknown }[] }[];
  summary?: unknown;
}

export function aiInput(members: GroupMember[], unmatched: LinkCandidate[], rest: MemberPoint[]): ConsolidationAiInput {
  const allowed = new Set(members.filter((m) => m.aiAllowed).map((m) => m.engagementId));
  return {
    members: members
      .filter((m) => allowed.has(m.engagementId))
      .map((m) => ({ id: m.engagementId, fund: m.fundName, entity: m.entityName, type: m.entityType || 'Not recorded' })),
    lines: unmatched
      .filter((c) => allowed.has(c.engagementId))
      .map((c) => ({
        id: c.id,
        fund: c.engagementId,
        where: c.where,
        label: c.label,
        amount: c.amount,
        currency: c.currency,
        side: c.side
      })),
    points: rest
      .filter((p) => allowed.has(p.engagementId))
      .map((p) => ({ fund: p.engagementId, ref: p.ref, title: p.title, area: p.area || '', kind: p.kind || '' }))
  };
}

/**
 * Applies the AI's pairs and groups after checking every reference it returns: lines and points must exist,
 * belong to two different funds, and not be used twice. Amounts are compared here, never taken from the AI.
 */
export function applyAiAnswer(
  answer: ConsolidationAiAnswer,
  cands: LinkCandidate[],
  rest: MemberPoint[],
  fundName: (id: string) => string,
  tol = 1
): { links: InterLink[]; groups: PointGroup[]; summary: string } {
  const byId = new Map(cands.map((c) => [c.id, c]));
  const used = new Set<string>();
  const links: InterLink[] = [];
  for (const p of Array.isArray(answer.pairs) ? answer.pairs : []) {
    const a = byId.get(String(p?.a ?? '')),
      b = byId.get(String(p?.b ?? ''));
    if (!a || !b || a.engagementId === b.engagementId || used.has(a.id) || used.has(b.id)) continue;
    used.add(a.id).add(b.id);
    links.push({ a, b, ...compareLink(a, b, tol), matchedBy: 'ai', relationship: str(p.relationship, 120), note: str(p.note, 400) });
  }
  const pointOf = new Map(rest.map((p) => [`${p.engagementId}|${p.ref}`, p]));
  const taken = new Set<string>();
  const groups: PointGroup[] = [];
  for (const g of Array.isArray(answer.groups) ? answer.groups : []) {
    const ps = (Array.isArray(g?.points) ? g.points : [])
      .map((x) => pointOf.get(`${String(x?.fund ?? '')}|${String(x?.ref ?? '')}`))
      .filter((p): p is MemberPoint => !!p && !taken.has(`${p.engagementId}|${p.ref}`));
    if (new Set(ps.map((p) => p.engagementId)).size < 2) continue;
    ps.forEach((p) => taken.add(`${p.engagementId}|${p.ref}`));
    groups.push({
      key: `ai:${groups.length + 1}`,
      title: str(g.title, 200) || ps[0]!.title,
      points: ps.map((p) => ({
        engagementId: p.engagementId,
        fundName: fundName(p.engagementId),
        ref: p.ref,
        title: p.title,
        status: p.status
      })),
      matchedBy: 'ai'
    });
  }
  return { links, groups, summary: str(answer.summary, 1200) || '' };
}

const str = (v: unknown, max: number): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);

// ---- the whole review, without AI -----------------------------------------------------------------------

/** Everything the app can do on its own; the AI step (when allowed) adds to `links`, `groups` and `summary`. */
export function consolidate(
  members: GroupMember[],
  points: MemberPoint[],
  tol = 1
): ConsolidationResult & { candidates: LinkCandidate[]; restPoints: MemberPoint[] } {
  const analysed = members.filter((m) => m.result);
  const known = memberNames(analysed);
  const candidates = analysed.flatMap((m) => linkCandidates(m, known));
  const links = matchByName(candidates, tol);
  const linked = new Set(links.flatMap((l) => [l.a.id, l.b.id]));
  const fundName = (id: string) => members.find((m) => m.engagementId === id)?.fundName || id;
  const { groups, rest } = groupCommonPoints(
    points.filter((p) => analysed.some((m) => m.engagementId === p.engagementId)),
    fundName
  );
  return {
    members: members.map((m) => ({
      engagementId: m.engagementId,
      fundName: m.fundName,
      entityName: m.entityName,
      currency: m.currency,
      analysed: !!m.result,
      aiAllowed: m.aiAllowed
    })),
    links,
    // every related-party line not yet paired, including charges named only by role ("the manager"),
    // which the AI step can pair with the manager's own line
    unmatched: candidates.filter((c) => !linked.has(c.id)),
    groups,
    summary: '',
    candidates,
    restPoints: rest
  };
}
