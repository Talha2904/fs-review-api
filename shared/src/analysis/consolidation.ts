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
  /** a balance reference both sides may quote ("IC-01", "PD-L01"); the same reference is the better partner */
  ref?: string | undefined;
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
  /** the group-wide balances ("due from group entities") of every fund added up: what the group is owed against what it owes */
  groupBalances?: GroupBalances | null;
  /** accounting policies a fund states differently from the rest of the group */
  policies?: PolicyDifference[];
}

/** A policy sentence one fund states where the other funds of the group say something else. */
export interface PolicyDifference {
  engagementId: string;
  fundName: string;
  /** the note it is in */
  where: string;
  /** what this fund says */
  says: string;
  /** what the other funds say in the same place, and which of them say it; null when they say nothing there */
  others: { text: string; funds: string[] } | null;
}

/**
 * Balances with the group in general, naming no member: inside one group every such receivable is some member's
 * payable, so the group's totals of each should agree (they eliminate on consolidation).
 */
export interface GroupBalances {
  /** null when the funds use different currencies: then no totals are compared */
  currency: string | null;
  owedTo: number;
  owedBy: number;
  difference: number | null;
  status: 'agrees' | 'differs' | 'different-currency';
  funds: { engagementId: string; fundName: string; currency: string; owedTo: number; owedBy: number; lines: string[] }[];
  /** funds of the group with no analysis: their balances are missing from the totals */
  notAnalysed: string[];
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

// ---- counterparty legends -------------------------------------------------------------------------------

/**
 * A related-party note may name the other side by a code and explain the codes below the table:
 * "PD-H  PD-A01-L02 payable  2,150,000" … "Counterparties: PD-H - Alderwick Lending Holdings Limited".
 * A code is one word of capitals and digits (hyphens allowed); single letters are left out, they are too common.
 */
const CODE = '[A-Z][A-Z0-9]*(?:-[A-Z0-9]+){0,3}';
const LEGEND_ENTRY = new RegExp(`(?:^|\\s)(${CODE})\\s+[-–—]\\s+`, 'g');
const isCode = (w: string): boolean => new RegExp(`^${CODE}$`).test(w) && w.length >= 2 && w.length <= 16;

/** The codes a paragraph explains: "PD-F - Alderwick Direct Lending I, L.P." (several may run together). */
export function legendEntries(text: string): { code: string; name: string }[] {
  const hits = [...String(text).matchAll(LEGEND_ENTRY)].filter((m) => isCode(m[1]!));
  // a legend paragraph starts with an entry; a sentence that only contains " - " somewhere is not one
  if (!hits.length || hits[0]!.index !== 0) return [];
  return hits
    .map((m, i) => ({
      code: m[1]!,
      name: String(text)
        .slice(m.index! + m[0].length, hits[i + 1]?.index ?? undefined)
        .trim()
    }))
    .filter((e) => e.name.length >= 3);
}

/** Every code explained in the fund's related-party notes, with the members each one names (none when outside the group). */
function legendOf(cy: Doc, self: string, known: Map<string, string[][]>): Map<string, string[]> {
  const out = new Map<string, string[]>();
  let inNote = false;
  for (const b of cy.blocks || []) {
    if (b.k === 'head') inNote = NOTE_HEAD.test(b.title || '');
    else if (inNote && b.k === 'para' && b.text)
      for (const e of legendEntries(b.text)) if (!out.has(e.code)) out.set(e.code, names(e.name, self, known));
  }
  return out;
}

/** The legend codes a line quotes, and its own reference: another code-like word with a digit ("IC-01", "PD-A01-L02"). */
function codesIn(label: string, legend: Map<string, string[]>): { parties: string[]; ref?: string } {
  const words = label.split(/\s+/).filter(Boolean);
  const parties = words.filter((w) => legend.has(w));
  const ref = words.find((w) => !legend.has(w) && isCode(w) && /\d/.test(w) && /-/.test(w));
  return { parties, ...(ref ? { ref } : {}) };
}

/** Balance-sheet lines and related-party note lines of one fund's current-year draft. */
export function linkCandidates(member: GroupMember, known: Map<string, string[][]>): LinkCandidate[] {
  const cy: Doc | undefined = member.result?.docs?.cy;
  if (!cy) return [];
  const out: LinkCandidate[] = [];
  const legend = legendOf(cy, member.engagementId, known);
  const add = (where: string, label: string, amount: number | null, side: LinkSide, extra = '') => {
    const { parties, ref } = codesIn(label, legend);
    const mentions = [...new Set([...names(`${label} ${extra}`, member.engagementId, known), ...parties.flatMap((p) => legend.get(p)!)])];
    // a line quoting a counterparty code is a related-party line, even when that party is outside the review
    if (!RELATED.test(label) && !mentions.length && !parties.length) return;
    if (out.some((c) => c.where === where && c.label === label && c.amount === amount)) return;
    out.push({
      id: `${member.engagementId}#${out.length + 1}`,
      engagementId: member.engagementId,
      fundName: member.fundName,
      where,
      label,
      amount,
      currency: member.currency,
      side,
      mentions,
      ...(ref ? { ref } : {})
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
      // the legend under a coded table explains the codes; it is not a balance itself
      if (legendEntries(b.text).length) continue;
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
 * Where one line has several possible partners, one quoting the same reference ("IC-01") wins, then the closest
 * amount. Each line is used once.
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
    const sameRef = (b: LinkCandidate) => (a.ref && b.ref === a.ref ? 0 : 1);
    const b = options.slice().sort((x, y) => sameRef(x) - sameRef(y) || gap(x) - gap(y))[0]!;
    used.add(a.id).add(b.id);
    links.push({ a, b, ...compareLink(a, b, tol), matchedBy: 'app' });
  }
  return links;
}

// ---- balances with the group in general ------------------------------------------------------------------

/** "Due to group entities", "Amounts owed by group undertakings", "Intercompany payable": the group, no member named. */
const GROUP_WIDE = /\b(group|intercompan|inter-?company|fellow subsidiar)/i;
/** "group" that is not the group of entities */
const NOT_GROUP = /\b(disposal group|group of assets)/i;
/** investments in, and capital of, subsidiaries are not balances owed */
const NOT_OWED = /\b(investment|share capital|shares)\b/i;

/** A balance-sheet amount owed to or by someone, not an investment or a disposal group. */
const owedOnBalanceSheet = (c: LinkCandidate): boolean =>
  c.side !== 'flow' &&
  c.amount != null &&
  /financial position|balance sheet/i.test(c.where) &&
  !NOT_OWED.test(c.label) &&
  !NOT_GROUP.test(c.label);

/** A balance-sheet line owed to or by the group in general, naming no member. */
export const isGroupWide = (c: LinkCandidate): boolean => !c.mentions.length && owedOnBalanceSheet(c) && GROUP_WIDE.test(c.label);

/** A balance-sheet line owed to or by another member: one naming it, or the group in general. */
export const isGroupBalance = (c: LinkCandidate): boolean => owedOnBalanceSheet(c) && (c.mentions.length > 0 || GROUP_WIDE.test(c.label));

/**
 * In a group of exactly two funds, both analysed, "the group" can only be the other fund: when one fund has a single
 * group-wide receivable and the other a single group-wide payable, the two are paired (and the reverse). With several
 * lines on a side nothing is paired line by line; the group totals compare them.
 */
export function matchGroupWideOfTwo(members: GroupMember[], cands: LinkCandidate[], tol = 1): InterLink[] {
  if (members.length !== 2 || members.some((m) => !m.result)) return [];
  const wide = cands.filter(isGroupWide);
  const [x, y] = members.map((m) => m.engagementId) as [string, string];
  const links: InterLink[] = [];
  for (const [from, to] of [
    [x, y],
    [y, x]
  ] as const) {
    const a = wide.filter((c) => c.engagementId === from && c.side === 'receivable');
    const b = wide.filter((c) => c.engagementId === to && c.side === 'payable');
    if (a.length === 1 && b.length === 1)
      links.push({
        a: a[0]!,
        b: b[0]!,
        ...compareLink(a[0]!, b[0]!, tol),
        matchedBy: 'app',
        relationship: 'Group balance: the only other fund in the group'
      });
  }
  return links;
}

/**
 * Every fund's balances with the group added up: lines naming another member and lines naming the group in general.
 * Inside one group, what the funds are owed should equal what they owe. Amounts are taken as positive, as in
 * compareLink. Null when no fund has any.
 */
export function groupBalancesOf(members: GroupMember[], cands: LinkCandidate[], tol = 1): GroupBalances | null {
  const lines = cands.filter(isGroupBalance);
  if (!lines.some(isGroupWide)) return null; // without a group-wide line the pairs by name already say it all
  const currencies = new Set(lines.map((c) => c.currency));
  const currency = currencies.size === 1 ? [...currencies][0]! : null;
  const sum = (list: LinkCandidate[]) => list.reduce((t, c) => t + Math.abs(c.amount ?? 0), 0);
  const funds = members
    .filter((m) => m.result)
    .map((m) => {
      const of = lines.filter((c) => c.engagementId === m.engagementId);
      return {
        engagementId: m.engagementId,
        fundName: m.fundName,
        currency: m.currency,
        owedTo: sum(of.filter((c) => c.side === 'receivable')),
        owedBy: sum(of.filter((c) => c.side === 'payable')),
        lines: of.map((c) => c.id)
      };
    });
  const owedTo = sum(lines.filter((c) => c.side === 'receivable')),
    owedBy = sum(lines.filter((c) => c.side === 'payable'));
  const difference = currency ? owedTo - owedBy : null;
  return {
    currency,
    owedTo,
    owedBy,
    difference,
    status: difference == null ? 'different-currency' : Math.abs(difference) <= tol ? 'agrees' : 'differs',
    funds,
    notAnalysed: members.filter((m) => !m.result).map((m) => m.fundName)
  };
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

// ---- accounting policies --------------------------------------------------------------------------------

/** Wording that states how something is measured, recognised or presented: an accounting policy. */
const POLICY =
  /\b(measured at|recognised|recognized|capitali[sz]ed|held at|at cost|fair value through|amortised cost|amortized cost|translated at|presented (separately|net|gross)|shown (gross|net)|accounted for|depreciat|amortis|amortiz|accounting polic|basis of (preparation|accounting)|going[- ]concern basis)/i;
/** a fund saying it changed a policy needs no other fund to compare with */
const CHANGED =
  /\b(changed (its|the|our)?\s*(accounting )?polic|change (in|of|to) (its |the |our )?(accounting )?polic(y|ies) (was|has been|is)|no longer|previously (measured|recognised|recognized|held|presented|accounted)|instead of)/i;

interface Sentence {
  where: string;
  raw: string;
  key: string;
}

/** Every sentence of a fund's current-year notes, with a key that ignores the group's own names, figures, case and labels. */
function sentencesOf(member: GroupMember, all: GroupMember[]): Sentence[] {
  const cy: Doc | undefined = member.result?.docs?.cy;
  if (!cy) return [];
  const names = all
    .flatMap((m) => [m.fundName, m.entityName])
    .filter((n) => n && n.length >= 4)
    .sort((a, b) => b.length - a.length)
    .map((n) => n.toLowerCase());
  const keyOf = (s: string) => {
    let k = s.toLowerCase();
    for (const n of names) k = k.split(n).join(' x ');
    return k
      .replace(/\d[\d,.]*/g, ' n ')
      .replace(/[^a-z ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  };
  const out: Sentence[] = [];
  let where = '';
  for (const b of cy.blocks || []) {
    if (b.k === 'head') where = String(b.title || '');
    if (b.k !== 'para' || !b.text) continue;
    // a reader may start a paragraph with its sub-heading ("Portfolio measurement: External loans …")
    const text = String(b.text).replace(/^[A-Z][A-Za-z ,/&-]{2,60}:\s+(?=[A-Z])/, '');
    for (const raw of text.split(/(?<=[.;])\s+(?=[A-Z])/)) {
      const key = keyOf(raw);
      if (key.length >= 20) out.push({ where, raw: raw.trim(), key });
    }
  }
  return out;
}

/**
 * Policies a fund states differently from the rest of the group. Funds of one group usually share most of their
 * notes word for word, so a policy sentence only one fund has is compared with what the others say in the same
 * place (after the same sentence, or before it): "Investment income is capitalised …" against "Investment income
 * is presented separately …". A policy sentence held by fewer than half the funds is compared, so two funds that
 * changed the same way are both found; what "the others" say must be said by at least two of them. A sentence
 * saying a policy was changed is reported even with nothing to compare. Needs three or more analysed funds.
 */
export function policyDifferences(members: GroupMember[]): PolicyDifference[] {
  const analysed = members.filter((m) => m.result);
  if (analysed.length < 3) return [];
  const sents = new Map(analysed.map((m) => [m.engagementId, sentencesOf(m, analysed)]));
  const holders = new Map<string, Set<string>>();
  for (const [id, list] of sents) for (const s of list) (holders.get(s.key) ?? holders.set(s.key, new Set()).get(s.key)!).add(id);
  const out: PolicyDifference[] = [];
  for (const m of analysed) {
    const list = sents.get(m.engagementId)!;
    const mine = new Set(list.map((s) => s.key));
    list.forEach((s, i) => {
      // a policy sentence that fewer than half the funds state (a fund saying "no longer" about anything else is no policy)
      if (holders.get(s.key)!.size * 2 >= analysed.length || !POLICY.test(s.raw)) return;
      // what the other funds say next to the same neighbouring sentence
      const found = new Map<string, { text: string; funds: Set<string> }>();
      for (const [nb, step] of [
        [list[i - 1], 1],
        [list[i + 1], -1]
      ] as const) {
        if (!nb || holders.get(nb.key)!.size < 2) continue;
        for (const [id, other] of sents) {
          if (id === m.engagementId) continue;
          const j = other.findIndex((o) => o.key === nb.key);
          const there = j < 0 ? undefined : other[j + step];
          if (!there || mine.has(there.key) || !POLICY.test(there.raw)) continue;
          const f = found.get(there.key) ?? found.set(there.key, { text: there.raw, funds: new Set() }).get(there.key)!;
          f.funds.add(id);
        }
        if (found.size) break;
      }
      const best = [...found.values()].filter((f) => f.funds.size >= 2).sort((a, b) => b.funds.size - a.funds.size)[0];
      if (!best && !CHANGED.test(s.raw)) return;
      const nameOf = (id: string) => analysed.find((x) => x.engagementId === id)!.fundName;
      out.push({
        engagementId: m.engagementId,
        fundName: m.fundName,
        where: s.where,
        says: s.raw,
        others: best ? { text: best.text, funds: [...best.funds].map(nameOf) } : null
      });
    });
  }
  return out;
}

/** Everything the app can do on its own; the AI step (when allowed) adds to `links`, `groups` and `summary`. */
export function consolidate(
  members: GroupMember[],
  points: MemberPoint[],
  tol = 1
): ConsolidationResult & { candidates: LinkCandidate[]; restPoints: MemberPoint[] } {
  const analysed = members.filter((m) => m.result);
  const known = memberNames(analysed);
  const candidates = analysed.flatMap((m) => linkCandidates(m, known));
  const byName = matchByName(candidates, tol);
  const pairedByName = new Set(byName.flatMap((l) => [l.a.id, l.b.id]));
  // with two funds, a balance with "the group" is a balance with the other fund
  // a line naming a fund not yet analysed is with that fund, not with "the group"
  const notAnalysed = new Set(members.filter((m) => !m.result).map((m) => m.engagementId));
  const knownAll = notAnalysed.size ? memberNames(members) : known;
  const namesNotAnalysed = (c: LinkCandidate) =>
    notAnalysed.size > 0 && names(c.label, c.engagementId, knownAll).some((id) => notAnalysed.has(id));
  // with two funds, a balance with "the group" is a balance with the other fund
  const links = [
    ...byName,
    ...matchGroupWideOfTwo(
      members,
      candidates.filter((c) => !pairedByName.has(c.id) && !namesNotAnalysed(c)),
      tol
    )
  ];
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
    groupBalances: groupBalancesOf(members, candidates, tol),
    policies: policyDifferences(members),
    candidates,
    restPoints: rest
  };
}
