// Reads an investment schedule (custodian valuation report) from an Excel workbook without AI.
// Handles a summary by asset class (used as printed) and a list of holdings (added up by asset class,
// or the total when there is no class column). Returns the same shape as an AI reading:
// { title, meta, blocks, figures: { sched } }, or null when no schedule layout is found.
import type { Block, Reading, Sheet } from '../types.js';

import { MONTHS_RE, num, round2, txt } from './tbReader.js';

interface Layout {
  header: number;
  valCol: number;
  classCol: number;
  secCol: number;
  levelCol: number;
}
interface Item {
  label: string;
  cls: string;
  value: number;
  level: number | null;
}
interface Table {
  sheet: string;
  L: Layout;
  items: Item[];
  stated: number | null;
}

function findTable(rows: unknown[][]): Layout | null {
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const low = (rows[i] as unknown[]).map((c) => txt(c).toLowerCase());
    const valCol = low.findIndex(
      (c) => /market value|fair value|valuation|^value\b|^mv\b|book value|base value/.test(c) && !/%|percent|price/.test(c)
    );
    if (valCol < 0) continue;
    const classCol = low.findIndex((c) => /asset class|^class\b|category|sector|asset type|^type\b/.test(c));
    let secCol = low.findIndex((c) => /security|holding|instrument|issuer|description|^name\b|investment/.test(c) && !/value/.test(c));
    // a "Holdings" column of counts is not a list of securities: the column must hold names
    if (secCol >= 0) {
      const below = rows
        .slice(i + 1, i + 12)
        .map((r) => txt(r[secCol]))
        .filter(Boolean);
      if (below.filter((t) => /[a-z]{3}/i.test(t)).length < Math.max(1, below.length / 2)) secCol = -1;
    }
    const levelCol = low.findIndex((c) => /level|hierarchy/.test(c));
    if (classCol < 0 && secCol < 0) continue;
    return { header: i, valCol, classCol, secCol, levelCol };
  }
  return null;
}

function readRows(rows: unknown[][], L: Layout): { items: Item[]; stated: number | null } {
  const items: Item[] = [];
  let stated: number | null = null;
  for (const raw of rows.slice(L.header + 1)) {
    const label = txt(raw[L.secCol >= 0 ? L.secCol : L.classCol]),
      cls = L.classCol >= 0 ? txt(raw[L.classCol]) : '';
    const v = num(raw[L.valCol]);
    if (/\btotal/i.test(label) || /\btotal/i.test(cls) || /\btotal/i.test(txt(raw[0]))) {
      if (v != null && !Number.isNaN(v)) stated = v;
      break;
    }
    if (!label && !cls) continue;
    if (v == null || Number.isNaN(v)) continue; // headings, notes, blank lines
    const lvl = L.levelCol >= 0 ? Number(String(raw[L.levelCol]).replace(/\D/g, '')) || null : null;
    items.push({ label: label || cls, cls, value: round2(v), level: lvl });
  }
  return { items, stated };
}

export function parseInvestmentSchedule(sheets: Sheet[] | null | undefined): Reading | null {
  let summary: Table | null = null,
    holdings: Table | null = null,
    title = '';
  for (const sh of sheets || []) {
    const rows = sh.rows || [],
      L = findTable(rows);
    if (!L) continue;
    const { items, stated } = readRows(rows, L);
    if (!items.length) continue;
    title ||= rows.slice(0, L.header).flat().map(txt).join(' ');
    const t: Table = { sheet: sh.name, L, items, stated };
    if (L.secCol < 0 && L.classCol >= 0) summary ||= t;
    else holdings ||= t;
  }
  if (!summary && !holdings) return null;

  // Asset class lines: the printed summary when there is one, else the holdings added up by class.
  let classes: { label: string; value: number }[];
  if (summary) classes = summary.items.map((x) => ({ label: x.label, value: x.value }));
  else if (holdings!.L.classCol >= 0) {
    const m = new Map<string, number>();
    holdings!.items.forEach((x) => m.set(x.cls || 'Other', round2((m.get(x.cls || 'Other') || 0) + x.value)));
    classes = [...m].map(([label, value]) => ({ label, value }));
  } else classes = [{ label: 'Total investments', value: round2(holdings!.stated ?? holdings!.items.reduce((a, x) => a + x.value, 0)) }];
  const total = round2(classes.reduce((a, c) => a + c.value, 0));
  const date =
    title.match(new RegExp(`(\\d{1,2})(?:st|nd|rd|th)? (${MONTHS_RE}) (\\d{4})`, 'i'))?.[0] ||
    title.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0] ||
    '';

  const blocks: Block[] = [
    {
      k: 'head',
      title: 'By Asset Class',
      sub: summary ? `As printed on “${summary.sheet}”` : `Added up from the holdings on “${holdings!.sheet}”`
    },
    {
      k: 'table',
      cols: ['Fair value'],
      label: 'Asset class',
      rows: [
        ...classes.map((c, i) => ({ l: c.label, ref: `IS-${i + 1}`, v: [c.value] })),
        { l: 'Total investments at fair value', b: true, v: [total] }
      ]
    }
  ];
  const levels = holdings?.items.some((x) => x.level)
    ? [1, 2, 3].map((n) => round2(holdings!.items.filter((x) => x.level === n).reduce((a, x) => a + x.value, 0)))
    : null;
  if (levels)
    blocks.push(
      { k: 'head', title: 'By Fair Value Level', sub: 'Added up from the holdings' },
      {
        k: 'table',
        cols: ['Fair value'],
        label: 'Level',
        rows: [
          ...levels.map((v, i) => ({ l: `Level ${i + 1}`, v: [v] })),
          { l: 'Total', b: true, v: [round2(levels.reduce((a, b) => a + b, 0))] }
        ]
      }
    );
  if (holdings && holdings.L.secCol >= 0)
    blocks.push(
      { k: 'head', title: 'Holdings', sub: `${holdings.items.length} holdings` },
      { k: 'table', cols: ['Fair value'], label: 'Holding', rows: holdings.items.map((x) => ({ l: x.label, v: [x.value] })) }
    );

  const statedTotal = (summary || holdings)!.stated;
  return {
    title: 'Schedule of Investments',
    meta: `${date ? `Custodian valuation at ${date} · ` : ''}read without AI · ${classes.length} asset class${classes.length === 1 ? '' : 'es'}${holdings ? ` · ${holdings.items.length} holdings` : ''}`,
    blocks,
    figures: { sched: classes.map((c) => c.value) },
    local: {
      classes: classes.length,
      holdings: holdings?.items.length || 0,
      total,
      statedTotal,
      totalAgrees: statedTotal == null || Math.abs(statedTotal - total) < 1,
      levels
    }
  };
}
