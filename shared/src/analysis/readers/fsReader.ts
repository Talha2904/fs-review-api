// Reads financial statements and supporting information from a digitally produced PDF without AI.
// Works from the position of each piece of text: statement and note headings, column headers (years
// or Level 1/2/3), table rows (a label followed by numbers, matched to columns by their right edge),
// sub-headings such as "Liabilities", totals and paragraphs. Figures for the checks are then picked
// out by fixed rules. Returns { title, meta, blocks, figures, local } or null when the layout is not
// recognised well enough (for example a scanned PDF), so the caller can fall back to AI.
import type { Block, CastResult, Figures, PdfContent, PdfLine, Reading, Row } from '../types.js';

const NUM = /^\(?[-−]?[£$€]?\d[\d,]*(\.\d+)?\)?%?$/;
const DASH = /^[—–-]$/;
const isNum = (s: string): boolean => NUM.test(s.replace(/\s/g, '')) || DASH.test(s.trim());
const isYear = (s: string): boolean => /^(19|20)\d{2}$/.test(s.trim());
export function parseAmount(s: string): number | null {
  const t = s.replace(/[\s£$€,%]/g, '').replace('−', '-');
  if (DASH.test(t) || !t) return null;
  const neg = /^\(.*\)$/.test(t);
  const v = Number(t.replace(/[()]/g, ''));
  return Number.isFinite(v) ? (neg ? -v : v) : null;
}
const HEADING =
  /^(statement of |balance sheet|income statement|notes to the|\d{1,2}\.\s+\S|note \d+\b|directors and other information|independent auditor|prospectus extract|minutes of |investment manager commentary)/i;
const TOTAL =
  /^(total\b|net assets attributable|net assets$|net operating (profit|loss)|(increase|decrease) in net assets|net assets at the end|profit for the year)/i;
const SUBLINE = /^(gbp|eur|usd|£|as at |year ended |for the year|period ended )/i;

/** Umbrella sub-fund names compare without "fund", "sub-fund", "plc", "icav" and punctuation. */
export const sameName = (a: unknown, b: unknown): boolean => {
  const n = (s: unknown) =>
    String(s || '')
      .toLowerCase()
      .replace(/sub-?fund|fund|the|plc|icav|[^a-z0-9]/g, '');
  return !!n(a) && n(a) === n(b);
};

export function layoutBlocks(lines: PdfLine[], names: string[] = []): Block[] {
  const isName = (s: string) => names.some((n) => sameName(n, s)) || /^total$/i.test(String(s).trim());
  const blocks: Block[] = [];
  let table: Block | null = null,
    cols: string[] | null = null,
    colX: number[] | null = null;
  const body = lines.filter((l) => l.y > 40 && l.y < l.pageHeight - 40); // skip running headers and footers
  for (let i = 0; i < body.length; i++) {
    const ln = body[i] as PdfLine,
      cells = ln.cells;
    let k = cells.length;
    while (k > 0 && isNum((cells[k - 1] as PdfLine['cells'][number]).str)) k--;
    const nums = cells.slice(k),
      labelCells = cells.slice(0, k),
      label = labelCells
        .map((c) => c.str)
        .join(' ')
        .trim();
    const last = blocks[blocks.length - 1];
    if (!nums.length) {
      if (HEADING.test(label) && label.length < 90) {
        blocks.push({ k: 'head', title: label, sub: '' });
        table = null;
        cols = null;
        colX = null;
        continue;
      }
      if (last?.k === 'head' && !table && SUBLINE.test(label) && label.length < 60 && cells.length === 1) {
        last.sub = last.sub ? `${last.sub} · ${label}` : label;
        continue;
      }
      // a header row of short column titles to the right (e.g. Level 1 | Level 2 | Level 3 | Total)
      const right = cells.filter((c) => c.x > ln.pageWidth * 0.4);
      if (right.length >= 2 && right.every((c) => (c.str.length <= 14 || isName(c.str)) && !isNum(c.str))) {
        cols = right.map((c) => c.str);
        colX = right.map((c) => c.x2);
        table = {
          k: 'table',
          cols,
          label: cells
            .filter((c) => c.x <= ln.pageWidth * 0.4)
            .map((c) => c.str)
            .join(' '),
          rows: []
        };
        blocks.push(table);
        continue;
      }
      // a short line between table rows is a sub-heading inside the table (e.g. "Liabilities")
      const nxt = body[i + 1];
      if (
        table &&
        cells.length === 1 &&
        label.length < 50 &&
        nxt &&
        nxt.page === ln.page &&
        isNum(nxt.cells[nxt.cells.length - 1]?.str || '')
      ) {
        table.rows!.push({ l: label, h: true });
        continue;
      }
      // otherwise text: join with the paragraph above when it continues it
      const prevLine = body[i - 1];
      if (last?.k === 'para' && prevLine && prevLine.page === ln.page && prevLine.y - ln.y < ln.height * 1.9 && !table)
        last.text += ' ' + label;
      else {
        blocks.push({ k: 'para', text: label });
        table = null;
      }
      continue;
    }
    if (nums.every((c) => isYear(c.str)) && (label === '' || !/\d{2},\d{3}/.test(label))) {
      // a year header: "As at 31 December | 2026 | 2025"
      // under a header of sub-fund names, years make "ABC Fund 2026", "ABC Fund 2025", …
      if (table && !table.rows!.length && cols && cols.every(isName) && nums.length % cols.length === 0 && nums.length > cols.length) {
        const per: number = nums.length / cols.length,
          named: string[] = cols;
        table.cols = cols = nums.map((c, j): string => `${named[Math.floor(j / per)]} ${c.str}`);
        colX = nums.map((c) => c.x2);
        continue;
      }
      cols = nums.map((c) => c.str);
      colX = nums.map((c) => c.x2);
      table = { k: 'table', cols, label, rows: [] };
      blocks.push(table);
      continue;
    }
    if (!label) continue;
    if (!table) {
      cols = nums.map((_, j) => `Value ${j + 1}`);
      colX = nums.map((c) => c.x2);
      table = { k: 'table', cols, label: '', rows: [] };
      blocks.push(table);
    }
    // place each number in the column whose header ends nearest to it
    const v: (number | null)[] = (cols as string[]).map(() => null);
    const xs = colX as number[];
    nums.forEach((c) => {
      let best = 0,
        d = Infinity;
      xs.forEach((x, j) => {
        const dd = Math.abs(x - c.x2);
        if (dd < d) {
          d = dd;
          best = j;
        }
      });
      v[best] = parseAmount(c.str);
    });
    table.rows!.push({ l: label, v, ...(TOTAL.test(label) ? { b: true } : {}), ...(/per share/i.test(label) ? { dp: 4 } : {}) });
  }
  return blocks.filter((b) => b.k !== 'table' || b.rows!.length);
}

// ---- umbrella accounts -----------------------------------------------------------------------
/**
 * Keeps one sub-fund's part of an umbrella document: its section (a heading or line naming it, up to the
 * next sub-fund) plus shared parts, and in tables with a column per sub-fund, only its columns.
 * Also returns the umbrella total check: the sub-fund columns add up to the Total column.
 */
export function selectFund(blocks: Block[], name: string, names: string[]): { blocks: Block[]; cast: CastResult[] } {
  const ownerOf = (text: string) =>
    names.find((n) => sameName(n, text) || new RegExp(`[—–-]\\s*${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i').test(text || ''));
  const out: Block[] = [],
    cast: CastResult[] = [];
  let owner: string | null | undefined = null;
  for (const b of blocks) {
    const text = b.k === 'head' ? (b.title as string) : b.k === 'para' ? (b.text as string) : '';
    const o = text ? ownerOf(text) : null;
    if (o) owner = o;
    else if (b.k === 'head' && /^notes to the/i.test(b.title as string)) owner = null;
    if (owner && !sameName(owner, name)) continue;
    if (b.k !== 'table') {
      out.push(b);
      continue;
    }
    const bcols = b.cols as string[],
      brows = b.rows as Row[];
    const fundCols = bcols
      .map((c, i) => [c, i] as const)
      .filter(([c]) => names.some((n) => String(c).toLowerCase().startsWith(n.toLowerCase())));
    if (fundCols.length < 2) {
      out.push(b);
      continue;
    }
    const mine = fundCols.filter(([c]) => String(c).toLowerCase().startsWith(name.toLowerCase()));
    // umbrella total check, per year group: sub-fund columns against the Total column
    const totals = bcols.map((c, i) => [c, i] as const).filter(([c]) => /^total/i.test(String(c)));
    for (const [tc, ti] of totals) {
      const yr = String(tc).match(/(19|20)\d{2}/)?.[0] || '';
      const parts = fundCols.filter(([c]) => !yr || String(c).endsWith(yr)).map(([, i]) => i);
      for (const r of brows)
        if (r.v && r.v[ti] != null && !r.h) {
          const rv = r.v;
          const sum = parts.reduce((a, i) => a + (rv[i] || 0), 0);
          cast.push({ where: r.l, col: tc, stated: rv[ti] as number, comp: sum, ok: Math.abs(sum - (rv[ti] as number)) <= 1 });
        }
    }
    if (!mine.length) continue;
    const keep = mine.map(([, i]) => i);
    out.push({
      ...b,
      cols: mine.map(([c]) => String(c).match(/(19|20)\d{2}$/)?.[0] || String(c)),
      rows: brows.map((r) => (r.v ? { ...r, v: keep.map((i) => (r.v as (number | null)[])[i] as number | null) } : r))
    });
  }
  return { blocks: out, cast };
}

// ---- figures for the checks -----------------------------------------------------------------
function sections(blocks: Block[]): { head: string; t: Block }[] {
  const out: { head: string; t: Block }[] = [];
  let head = '';
  for (const b of blocks) {
    if (b.k === 'head') head = b.title as string;
    else if (b.k === 'table') out.push({ head, t: b });
  }
  return out;
}
const cyIndex = (t: Block): number => {
  const ys = (t.cols as string[]).map((c) => (isYear(c) ? +c : null));
  const m = Math.max(...(ys.filter(Boolean) as number[]));
  return ys.some(Boolean) ? ys.indexOf(m) : 0;
};
const pyIndex = (t: Block): number | null => {
  const ys = (t.cols as string[]).map((c) => (isYear(c) ? +c : null)).filter(Boolean) as number[];
  if (ys.length < 2) return null;
  const s = [...ys].sort((a, b) => b - a)[1];
  return (t.cols as string[]).indexOf(String(s));
};

type FigRow = Row & { cy: number | null | undefined; py: number | null | undefined };

export function statementFigures(blocks: Block[]): Figures {
  const F: Figures = {},
    secs = sections(blocks);
  const find = (re: RegExp, not?: RegExp) => secs.filter((s) => re.test(s.head) && !(not && not.test(s.head)));
  const rowsOf = (list: { head: string; t: Block }[]): FigRow[] =>
    list.flatMap((s) =>
      (s.t.rows as Row[]).map((r) => {
        const pi = pyIndex(s.t);
        return { ...r, cy: r.v ? r.v[cyIndex(s.t)] : null, py: r.v && pi != null ? r.v[pi] : null };
      })
    );
  const val = (x: number | null | undefined) => x as number;
  // Statement of financial position: asset lines, liability lines, totals
  const sfp = rowsOf(find(/financial position|balance sheet/i, /changes/i));
  if (sfp.length) {
    let phase = 'assets';
    const ca: number[] = [],
      cl: number[] = [];
    F.ca = ca;
    F.cl = cl;
    for (const r of sfp) {
      if (r.h) {
        if (/liabilit/i.test(r.l)) phase = 'liab';
        continue;
      }
      if (/^total assets/i.test(r.l)) {
        F.statedTA = r.cy;
        phase = 'liab';
        continue;
      }
      if (/^total liabilities/i.test(r.l)) {
        phase = 'after';
        continue;
      }
      if (/^net assets attributable|^net assets$/i.test(r.l)) {
        F.statedNA = r.cy;
        phase = 'after';
        continue;
      }
      if (r.b || r.dp || /per share|shares in issue/i.test(r.l) || r.cy == null) continue;
      if (phase === 'assets') ca.push(r.cy);
      else if (phase === 'liab') cl.push(Math.abs(r.cy));
    }
  }
  // Statement of comprehensive income
  const sci = rowsOf(find(/comprehensive income|income statement|profit and loss|statement of operations/i));
  if (sci.length) {
    const income: number[] = [];
    F.income = income;
    for (const r of sci) {
      if (/^total (investment )?income/i.test(r.l)) {
        F.statedIncome = r.cy;
        break;
      }
      if (!r.b && !r.h && r.cy != null) income.push(r.cy);
    }
    const ex = sci.find((r) => /operating expenses|^total expenses|^expenses/i.test(r.l));
    if (ex) F.sciExp = Math.abs(val(ex.cy));
    const op = sci.find((r) => /(increase|decrease) in net assets.*operations|profit for the year/i.test(r.l));
    if (op) F.ops = op.cy;
  }
  // Statement of changes in net assets
  const socna = rowsOf(find(/changes in net assets|changes in equity/i));
  if (socna.length) {
    const open = socna.find((r) => /beginning|brought forward|opening|^at 1 /i.test(r.l));
    if (open) {
      F.pyNA = open.cy;
      if (open.py != null) F.pyOpenNA = open.py;
    }
    const sub = socna.find((r) => /subscription|issue of (redeemable )?(participating )?shares/i.test(r.l));
    if (sub) F.subs = Math.abs(val(sub.cy));
    const red = socna.find((r) => /redemption/i.test(r.l));
    if (red) F.reds = Math.abs(val(red.cy));
    const dist = socna.find((r) => /distribution|dividends? (paid|to shareholders|declared)/i.test(r.l));
    F.dists = dist ? Math.abs(dist.cy || 0) : 0;
    const op = socna.find((r) => /(increase|decrease) in net assets.*operations/i.test(r.l));
    if (op && F.ops == null) F.ops = op.cy;
  }
  // Notes: operating expenses, investments, fair value hierarchy
  const notes = /^(\d{1,2}\.|note \d)/i;
  const expNote = secs.filter((s) => notes.test(s.head) && /expenses/i.test(s.head));
  if (expNote.length) {
    const rows = rowsOf(expNote);
    F.exp = rows.filter((r) => !r.b && !r.h && r.cy != null).map((r) => r.cy as number);
    const m = rows.find((r) => /management fee/i.test(r.l));
    if (m) F.mgmtCharged = m.cy;
  }
  const invNote = secs.filter(
    (s) =>
      notes.test(s.head) &&
      /financial assets at fair value|investments at fair value|^\S+\s+investments\b/i.test(s.head) &&
      !/hierarchy/i.test(s.head)
  );
  if (invNote.length) {
    const t = rowsOf(invNote).find((r) => r.b && /^total/i.test(r.l));
    if (t) F.statedNote4 = t.cy;
  }
  const hier = secs.find((s) => /fair value hierarchy/i.test(s.head));
  if (hier) {
    const r = (hier.t.rows as Row[]).find((r) => r.v && r.v.length >= 3);
    if (r) F.hier = (r.v as (number | null)[]).slice(0, 3).map((x) => x ?? 0);
  }
  return F;
}

// ---- per document type ----------------------------------------------------------------------
const REQUIRED_CY = ['statedTA', 'statedNA', 'statedIncome'];
const OPTIONAL_CY = [
  'ca',
  'cl',
  'pyNA',
  'pyOpenNA',
  'subs',
  'reds',
  'ops',
  'income',
  'sciExp',
  'exp',
  'statedNote4',
  'hier',
  'mgmtCharged'
];

export interface Umbrella {
  name: string;
  names: string[];
}

/** Reads a statements or supporting-information PDF; umbrella picks one sub-fund from umbrella accounts. */
export function parseFinancialPdf(content: PdfContent | null | undefined, slot: string, umbrella: Umbrella | null = null): Reading | null {
  const lines = content?.lines || [];
  if (lines.length < 10) return null; // no text layer: scanned or empty
  let blocks = layoutBlocks(lines, umbrella?.names || []),
    umbrellaCast: CastResult[] | null = null;
  if (umbrella?.name && umbrella.names?.length > 1) {
    const sel = selectFund(blocks, umbrella.name, umbrella.names);
    blocks = sel.blocks;
    umbrellaCast = sel.cast;
  }
  const tables = blocks.filter((b) => b.k === 'table'),
    heads = blocks.filter((b) => b.k === 'head');
  if (slot === 'sup') {
    const text = content?.text || '';
    const m = text.match(/management fee\.?[^%]{0,200}?(\d+(?:\.\d+)?)\s*%/i);
    const figures: Figures = m ? { mgmtRate: Number(m[1]) / 100 } : {};
    if (!heads.length && !blocks.length) return null;
    return {
      title: 'Supporting Information',
      meta: `read without AI · ${heads.length} section${heads.length === 1 ? '' : 's'}${m ? ` · management fee ${m[1]}%` : ''}`,
      blocks,
      figures,
      local: { found: Object.keys(figures), missing: m ? [] : ['mgmtRate'] }
    };
  }
  const statements = heads.filter((h) => /^statement of|balance sheet|income statement/i.test(h.title as string)).length;
  if (!statements || (!tables.some((t) => (t.cols as string[]).some(isYear)) && !umbrella)) return null; // umbrella columns may be named, not dated
  if (slot === 'py')
    return {
      ...(content?.ocr ? { ocr: content.ocr } : {}),
      title: 'Signed Financial Statements',
      meta: `read without AI · ${statements} statements, ${tables.length} tables${umbrella ? ` · ${umbrella.name}` : ''}`,
      blocks,
      figures: {},
      local: { found: [], missing: [] }
    };
  const F = statementFigures(blocks);
  const missing = REQUIRED_CY.filter((k) => F[k] == null);
  if (missing.length) return null; // key figures not found: let AI read it
  return {
    title: 'Draft Financial Statements',
    meta: `read without AI · ${statements} statements, ${tables.length} tables${umbrella ? ` · ${umbrella.name} (umbrella accounts)` : ''}`,
    blocks,
    figures: F,
    umbrellaCast: umbrellaCast as CastResult[],
    local: {
      found: Object.keys(F),
      missing: OPTIONAL_CY.filter((k) => {
        const f = F[k];
        return f == null || (Array.isArray(f) && !f.length);
      })
    },
    ...(content?.ocr ? { ocr: content.ocr } : {})
  };
}
