// Reads a trial balance from an Excel workbook without AI. Finds the header row (Debit and Credit
// columns, or a single signed Balance column), the account code and name columns, then every account
// row down to the totals. Returns the same shape as an AI reading: { title, meta, blocks, figures }.
// Returns null when no trial balance layout is found, so the caller can fall back to AI.
import type { Reading, Sheet } from '../types.js';

export const txt = (c: unknown): string => (c == null ? '' : c instanceof Date ? c.toISOString().slice(0, 10) : String(c)).trim();

/** "1,234.50", "(1,234.50)", "-1234", "1,234 CR", "£1,234" to a number; blank to null; other text to NaN. */
export function num(c: unknown): number | null {
  if (c == null || c === '') return null;
  if (typeof c === 'number') return c;
  let s = txt(c).replace(/[£$€\s,]/g, '');
  if (!s || s === '-' || s === '–') return null;
  let sign = 1;
  if (/^\(.*\)$/.test(s)) {
    sign = -1;
    s = s.slice(1, -1);
  }
  if (/cr$/i.test(s)) {
    sign = -sign;
    s = s.slice(0, -2);
  } else if (/dr$/i.test(s)) s = s.slice(0, -2);
  const v = Number(s);
  return Number.isFinite(v) ? sign * v : NaN;
}
export const round2 = (v: number): number => Math.round(v * 100) / 100;
export const MONTHS_RE = 'january|february|march|april|may|june|july|august|september|october|november|december';

interface Layout {
  header: number;
  dr: number;
  cr: number;
  balCol: number;
  codeCol: number;
  nameCol: number;
}

function findLayout(rows: unknown[][]): Layout | null {
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const r = (rows[i] as unknown[]).map(txt),
      low = r.map((c) => c.toLowerCase());
    const dr = low.findIndex((c) => /^debits?\b|^dr\b/.test(c)),
      cr = low.findIndex((c) => /^credits?\b|^cr\b/.test(c));
    const balCol = low.findIndex((c) => /^(closing )?balance\b|^net\b|^amount\b/.test(c));
    if ((dr < 0 || cr < 0) && balCol < 0) continue;
    // an explicit name or description column wins; a plain "Account" column is then the code
    let nameCol = low.findIndex((c) => /name|description|details/.test(c));
    const acctCol = low.findIndex((c) => /^account$/.test(c));
    let codeCol = low.findIndex((c) => /\b(code|no\.?|number|nominal|a\/c|ref)\b/.test(c) && !/name|desc/.test(c));
    if (nameCol < 0 && codeCol < 0 && acctCol >= 0) nameCol = acctCol;
    else if (codeCol < 0 && acctCol >= 0 && acctCol !== nameCol) codeCol = acctCol;
    if (nameCol < 0 || nameCol === codeCol) {
      // the column, left of the amounts, holding the most text in the rows below
      const first = Math.min(...[dr, cr, balCol].filter((x) => x >= 0));
      let best = -1,
        n = 0;
      for (let c = 0; c < first; c++) {
        if (c === codeCol) continue;
        const k = rows.slice(i + 1, i + 30).filter((x) => /[a-z]{3}/i.test(txt(x[c]))).length;
        if (k > n) {
          n = k;
          best = c;
        }
      }
      nameCol = best;
    }
    if (nameCol < 0) continue;
    return { header: i, dr, cr, balCol: dr >= 0 && cr >= 0 ? -1 : balCol, codeCol, nameCol };
  }
  return null;
}

export function parseTrialBalance(sheets: Sheet[] | null | undefined): Reading | null {
  for (const sh of sheets || []) {
    const rows = sh.rows || [],
      L = findLayout(rows);
    if (!L) continue;
    const accounts: { code: string; name: string; dr: number | null; cr: number | null }[] = [];
    let stated: { dr: number; cr: number } | null = null;
    for (const raw of rows.slice(L.header + 1)) {
      const name = txt(raw[L.nameCol]),
        code = L.codeCol >= 0 ? txt(raw[L.codeCol]) : '';
      const label = `${code} ${name}`.trim();
      let dr: number | null, cr: number | null;
      if (L.balCol >= 0) {
        const b = num(raw[L.balCol]);
        if (b == null || Number.isNaN(b)) {
          dr = cr = null;
        } else {
          dr = b > 0 ? b : null;
          cr = b < 0 ? -b : null;
        }
      } else {
        dr = num(raw[L.dr]);
        cr = num(raw[L.cr]);
        if (Number.isNaN(dr)) dr = null;
        if (Number.isNaN(cr)) cr = null;
      }
      if (/\btotals?\b/i.test(label)) {
        if (dr != null || cr != null) stated = { dr: dr || 0, cr: cr || 0 };
        break;
      } // the totals row ends the table
      if (!name && !code) continue;
      if (dr == null && cr == null) continue; // section heading or blank line
      accounts.push({ code: code || name, name: name || code, dr: dr ? round2(Math.abs(dr)) : null, cr: cr ? round2(Math.abs(cr)) : null });
    }
    if (accounts.length < 2) continue;
    const sumDr = round2(accounts.reduce((a, x) => a + (x.dr || 0), 0)),
      sumCr = round2(accounts.reduce((a, x) => a + (x.cr || 0), 0));
    // the reporting date, usually in a title above the table ("as at 31 December 2026")
    const above = rows.slice(0, L.header).flat().map(txt).join(' ');
    const date =
      above.match(new RegExp(`(\\d{1,2})(?:st|nd|rd|th)? (${MONTHS_RE}) (\\d{4})`, 'i'))?.[0] ||
      above.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0] ||
      '';
    const tbDr = stated ? round2(stated.dr) : sumDr,
      tbCr = stated ? round2(stated.cr) : sumCr;
    return {
      title: 'Trial Balance',
      meta: `${date ? `As at ${date} · ` : ''}read from “${sh.name}” without AI · ${accounts.length} accounts`,
      blocks: [
        {
          k: 'table',
          cols: ['Debit', 'Credit'],
          label: 'Account',
          rows: [...accounts.map((a) => ({ l: a.name, ref: a.code, v: [a.dr, a.cr] })), { l: 'Totals', b: true, v: [tbDr, tbCr] }]
        }
      ],
      figures: { tbDr, tbCr },
      local: { sheet: sh.name, accounts: accounts.length, statedTotals: !!stated, sumDr, sumCr }
    };
  }
  return null;
}
