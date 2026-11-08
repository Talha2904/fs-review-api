// Which passages of the standards go with a review (Phase 6): the ones most relevant to this fund's draft, found by
// ranking every passage of the fund's framework against the draft's own words (its statement and note headings,
// line labels and note text), within a fixed budget so the AI call grows by a few thousand tokens, not by whole
// standards. Plain BM25 ranking: no embeddings, no external service, the same answer every time for the same draft.
import type { StandardPassage, StandardsFramework } from '../ports/StandardsLibrary.js';

/** The framework whose standards apply, or null when none were supplied (US GAAP, Other, not set). */
export function standardsFramework(framework: string | null | undefined): StandardsFramework | null {
  const fw = String(framework ?? '').trim();
  if (/^FRS 102/i.test(fw)) return 'FRS 102';
  if (/^IFRS/i.test(fw)) return 'IFRS';
  return null;
}

const STOP = new Set(
  'the and for with that this from are was were has have had not but its their which shall may any all each other than such into been also per under where when what who whom whose will would could should can our out more most less note notes year years period total entity entities financial statements statement paragraph paragraphs section standard ifrs ias frs'.split(
    ' '
  )
);
const words = (s: string): string[] =>
  s
    .toLowerCase()
    .replace(/[^a-z\s-]/g, ' ')
    .split(/[\s-]+/)
    .filter((w) => w.length >= 3 && !STOP.has(w))
    .map((w) => (w.length > 4 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w));

interface Index {
  docs: Map<string, number>[];
  len: number[];
  avg: number;
  df: Map<string, number>;
  /** word -> the passages that contain it: only those are scored for a query */
  postings: Map<string, number[]>;
  /** the words of each passage's section title or heading */
  titles: Set<string>[];
}
const indexes = new WeakMap<StandardPassage[], Index>();
function indexOf(passages: StandardPassage[]): Index {
  const hit = indexes.get(passages);
  if (hit) return hit;
  const docs = passages.map((p) => {
    const tf = new Map<string, number>();
    // the heading says what the paragraph is about: it counts twice
    for (const w of [...words(p.text), ...words(p.topic), ...words(p.topic)]) tf.set(w, (tf.get(w) ?? 0) + 1);
    return tf;
  });
  const len = docs.map((d) => [...d.values()].reduce((a, b) => a + b, 0));
  const df = new Map<string, number>();
  const postings = new Map<string, number[]>();
  docs.forEach((d, i) => {
    for (const w of d.keys()) {
      df.set(w, (df.get(w) ?? 0) + 1);
      const list = postings.get(w);
      if (list) list.push(i);
      else postings.set(w, [i]);
    }
  });
  const titles = passages.map((p) => new Set(words(p.topic)));
  const idx = { docs, len, avg: len.reduce((a, b) => a + b, 0) / Math.max(1, len.length), df, postings, titles };
  indexes.set(passages, idx);
  return idx;
}

/** One area of the draft: a statement or note heading, and what sits under it. */
export interface DraftTopic {
  heading: string;
  text: string;
}

/**
 * The draft's areas, one per statement or note heading: its heading, line labels and note text (cut at a limit).
 * Each is searched on its own, so every area of the review gets its own passages.
 */
export function draftTopics(cy: unknown, entityType?: string | null): DraftTopic[] {
  const out: DraftTopic[] = [];
  let cur: DraftTopic | null = null;
  const blocks = (cy as { blocks?: unknown[] } | null)?.blocks;
  for (const b of Array.isArray(blocks) ? blocks : []) {
    const x = b as { k?: string; title?: string; label?: string; text?: string; rows?: { l?: string }[] };
    if (x.k === 'head' && x.title) {
      // "Note 6 — Related Party Transactions": the topic is the words after the note number
      cur = { heading: x.title.replace(/^(note\s*\d+[a-z]?\s*[—–:-]?\s*)/i, '').trim(), text: '' };
      out.push(cur);
      continue;
    }
    if (!cur) continue;
    const add = (t: string) => {
      if (cur!.text.length < 1500) cur!.text += ' ' + t;
    };
    if (x.k === 'table') {
      if (x.label) add(x.label);
      for (const r of x.rows ?? []) if (r?.l) add(r.l);
    }
    if (x.k === 'para' && x.text) add(x.text);
  }
  void entityType; // the entity's type is in the system prompt; as a search area it matched unrelated passages
  return out.filter((t) => t.heading).map((t) => ({ ...t, heading: synonyms(t.heading) }));
}

// how fund statements name things, against how the standards name them
const SYNONYMS: [RegExp, string][] = [
  [/net assets/i, 'equity'],
  [/distributions?/i, 'dividends'],
  [/reporting date/i, 'reporting period'],
  [/operating expenses/i, 'expenses'],
  [/comprehensive income/i, 'profit or loss']
];
const synonyms = (heading: string) =>
  heading +
  SYNONYMS.filter(([re]) => re.test(heading))
    .map(([, w]) => ` ${w}`)
    .join('');

/** Kept for callers that pass one block of text: the whole draft as one area. */
export function draftQuery(cy: unknown, entityType?: string | null): DraftTopic[] {
  return draftTopics(cy, entityType);
}

const ROUNDS = 2; // each area gets at most twice this many passages
const RELEVANT = 0.6;

/**
 * The passages to send: for each area of the draft, the passages ranked best for it (BM25 on the area's words, with
 * a boost where the passage's own section title matches the area's heading), taken in turns across the areas so
 * every area is covered; at most `perStandard` from one standard or section, up to `budget` characters. Returned in
 * the standards' own order.
 */
export function selectPassages(
  passages: StandardPassage[],
  topics: DraftTopic[] | string,
  budget = 24000,
  perStandard = 8
): StandardPassage[] {
  if (!passages.length) return [];
  const areas = typeof topics === 'string' ? [{ heading: '', text: topics }] : topics;
  if (!areas.length) return [];
  const idx = indexOf(passages);
  const N = passages.length,
    k1 = 1.2,
    b = 0.75;
  const titleWords = idx.titles;
  const ranked = areas.map((a) => {
    const q = new Map<string, number>();
    // the heading names the area: its words count three times
    for (const w of [...words(a.heading), ...words(a.heading), ...words(a.heading), ...words(a.text)]) q.set(w, (q.get(w) ?? 0) + 1);
    const head = [...new Set(words(a.heading))];
    const acc = new Map<number, number>();
    for (const [w, qf] of q) {
      const list = idx.postings.get(w);
      if (!list) continue;
      const n = idx.df.get(w) ?? 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      for (const i of list) {
        const f = idx.docs[i]!.get(w)!;
        acc.set(i, (acc.get(i) ?? 0) + idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * idx.len[i]!) / idx.avg))) * Math.log2(1 + qf));
      }
    }
    // a passage in the section of the same name ("Related Party Disclosures") is about this area
    const scores = [...acc].map(([i, s0]) => ({
      i,
      s: head.length ? s0 * (1 + (2 * head.filter((w) => titleWords[i]!.has(w)).length) / head.length) : s0
    }));
    // only clearly relevant passages: a good share of this area's best match; and when no section of the
    // standards is named like the area (an expenses note, say), only its single best passage
    const sorted = scores.filter((x) => x.s > 0).sort((x, y) => y.s - x.s);
    const top = sorted[0]?.s ?? 0;
    const named = sorted.some((x) => head.some((w) => titleWords[x.i]!.has(w)) && x.s >= top * RELEVANT);
    return sorted
      .filter((x) => x.s >= top * RELEVANT && (!named || head.some((w) => titleWords[x.i]!.has(w))))
      .slice(0, named ? ROUNDS * 2 : 1)
      .map((x) => x.i);
  });
  const chosen = new Set<number>();
  const per = new Map<string, number>();
  let used = 0;
  for (let round = 0; round < ROUNDS * 2 && used < budget - 200; round++)
    for (const list of ranked) {
      // the next passage for this area that is not already taken and fits
      for (const i of list.slice(round)) {
        if (chosen.has(i)) continue;
        const p = passages[i]!;
        const size = p.text.length + p.ref.length + p.topic.length + 8;
        if ((per.get(p.std) ?? 0) >= perStandard || used + size > budget) break;
        chosen.add(i);
        per.set(p.std, (per.get(p.std) ?? 0) + 1);
        used += size;
        break;
      }
    }
  return [...chosen].sort((x, y) => x - y).map((i) => passages[i]!);
}

// ---- effective dates ------------------------------------------------------------------------------------------
// The standards supplied are the latest editions: FRS 102 (September 2024 edition, with the Periodic Review
// amendments for periods beginning on or after 1 January 2026) and the IFRS Standards including IFRS 18 and IFRS 19
// (from 1 January 2027). For each review the period is worked out from the fund's year end, and what is not yet in
// force for that period is left out, so nothing needs editing as time passes. Only these dates are fixed: they are
// the standards' own.
const EFFECTIVE: { framework: StandardsFramework; std: RegExp; from: string; what: string }[] = [
  {
    framework: 'FRS 102',
    std: /^FRS 102 Section (2A|20|23)$/,
    from: '2026-01-01',
    what: 'Sections 2A, 20 and 23 as amended by the 2024 Periodic Review'
  },
  { framework: 'IFRS', std: /^IFRS 18$/, from: '2027-01-01', what: 'IFRS 18' },
  { framework: 'IFRS', std: /^IFRS 19$/, from: '2027-01-01', what: 'IFRS 19' }
];
// amendments made to other paragraphs from these dates: their wording may already show in the extracts
const AMENDED: Record<StandardsFramework, { from: string; note: string }> = {
  'FRS 102': { from: '2026-01-01', note: 'Paragraphs of other sections may show wording amended from 1 January 2026.' },
  IFRS: {
    from: '2027-01-01',
    note: 'Some paragraphs (for example in IAS 7 and IAS 8) may show wording amended by IFRS 18 from 1 January 2027.'
  }
};

/** The first day of the period that ends on this year end (a year earlier, plus a day); today when not known. */
export function periodStart(yearEnd: string | null | undefined, today = new Date()): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(yearEnd ?? ''));
  if (!m) return today.toISOString().slice(0, 10);
  // the day after the year end, a year earlier: 29 February 2024 -> 1 March 2023
  const d = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]! + 1));
  d.setUTCFullYear(d.getUTCFullYear() - 1);
  return d.toISOString().slice(0, 10);
}

/** The passages in force for a period starting on this date. */
export function inForce(framework: StandardsFramework, passages: StandardPassage[], start: string): StandardPassage[] {
  const later = EFFECTIVE.filter((e) => e.framework === framework && start < e.from);
  return later.length ? passages.filter((p) => !later.some((e) => e.std.test(p.std))) : passages;
}

/** What the AI is told about the edition and what was left out for this period. */
function editionNote(framework: StandardsFramework, start: string): string {
  const left = EFFECTIVE.filter((e) => e.framework === framework && start < e.from).map((e) => e.what);
  const edition = framework === 'FRS 102' ? 'FRS 102 (September 2024 edition)' : 'the IFRS Standards supplied (IAS 1 is not among them)';
  const parts = [`Extracts from ${edition}. The period reviewed begins ${start}.`];
  if (left.length) parts.push(`Not yet in force for this period, so left out: ${left.join('; ')}.`);
  if (start < AMENDED[framework].from)
    parts.push(`${AMENDED[framework].note} Rely on such a paragraph only where its requirement already applied to this period.`);
  return parts.join(' ');
}

/** The passages as one text block for the AI, each under its reference, after a note on edition and period. */
export function extractsBlock(framework: StandardsFramework, passages: StandardPassage[], start?: string): string {
  return `<standards_extracts framework="${framework}">\n${start ? editionNote(framework, start) + '\n' : ''}${passages
    .map((p) => `[${p.ref}]${p.topic ? ` (${p.topic})` : ''} ${p.text}`)
    .join('\n')}\n</standards_extracts>`;
}

// ---- citations ------------------------------------------------------------------------------------------------
const CITATION =
  /\b(FRS 102 (?:PBE)?\d{1,2}[A-Z]{0,2}\.\d{1,3}[A-Z]{0,2}|(?:IAS|IFRS) \d{1,2} [A-Z]{0,2}\d{1,3}(?:\.\d{1,3}){0,3}[A-Z]{0,2})(?: \((?:continued(?: \d+)?|part \d+|\d+)\))?/g;

/**
 * A point may cite only paragraphs that were sent with the review: any other paragraph reference is cut back to
 * the standard's name ("IAS 24 99" -> "IAS 24"), so a guessed paragraph number never reaches a review point.
 */
export function checkCitations(refs: string, sent: Set<string>): string {
  return refs.replace(CITATION, (whole) => {
    if (sent.has(whole)) return whole;
    const base = whole.replace(/ \((?:continued(?: \d+)?|part \d+|\d+)\)$/, '');
    if (sent.has(base)) return whole;
    const m = /^(FRS 102|IAS \d{1,2}|IFRS \d{1,2})/.exec(whole);
    return m ? `${m[1]} (paragraph not verified)` : whole;
  });
}
