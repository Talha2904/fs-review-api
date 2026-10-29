// Builds the analysis test documents under test/fixtures/analysis from the sample fund: digitally
// produced PDFs (positioned text, as an administrator's system would print them), Excel workbooks, an
// umbrella set with two sub-funds, a revised draft for the version pass, and a scanned page for OCR.
// Run: npm run fixtures:analysis   (the output is committed; rerun only when the sample changes)
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import * as XLSX from 'xlsx';

import { applyV3, SampleFund, type Block, type Doc, type Row } from '@fs-review/shared/analysis';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../test/fixtures/analysis');
const W = 595,
  H = 842,
  LEFT = 50;

const money = (v: number | null | undefined, dp = 0): string => {
  if (v == null) return '—';
  const a = Math.abs(v).toLocaleString('en-GB', { minimumFractionDigits: dp, maximumFractionDigits: dp });
  return v < 0 ? `(${a})` : a;
};
const wrap = (text: string, max: number): string[] => {
  const out: string[] = [];
  let line = '';
  for (const w of text.split(/\s+/)) {
    if ((line + ' ' + w).trim().length > max) {
      out.push(line);
      line = w;
    } else line = (line + ' ' + w).trim();
  }
  if (line) out.push(line);
  return out;
};
// pdf-lib's standard fonts cannot encode every character; these are the ones the sample uses.
const safe = (s: string): string => s.replace(/[−]/g, '-').replace(/[’‘]/g, "'").replace(/[“”]/g, '"');

class Writer {
  private page!: PDFPage;
  private y = 0;
  constructor(
    private readonly pdf: PDFDocument,
    private readonly font: PDFFont,
    private readonly bold: PDFFont
  ) {
    this.newPage();
  }
  private newPage() {
    this.page = this.pdf.addPage([W, H]);
    this.y = H - 60;
    this.page.drawText('Running header: prepared by the administrator', {
      x: LEFT,
      y: H - 25,
      size: 7,
      font: this.font,
      color: rgb(0.4, 0.4, 0.4)
    });
    this.page.drawText(`Page ${this.pdf.getPageCount()}`, { x: W - 90, y: 20, size: 7, font: this.font });
  }
  private need(lines: number, lh: number) {
    if (this.y - lines * lh < 60) this.newPage();
  }
  text(s: string, x: number, size = 8, b = false) {
    this.page.drawText(safe(s), { x, y: this.y, size, font: b ? this.bold : this.font });
  }
  right(s: string, x2: number, size = 8, b = false) {
    const f = b ? this.bold : this.font;
    this.page.drawText(safe(s), { x: x2 - f.widthOfTextAtSize(safe(s), size), y: this.y, size, font: f });
  }
  down(lh = 11) {
    this.y -= lh;
  }
  heading(title: string, sub?: string) {
    this.need(4, 12);
    this.down(6);
    this.text(title, LEFT, 11, true);
    this.down(13);
    if (sub) {
      this.text(sub, LEFT, 8);
      this.down(12);
    }
  }
  para(text: string) {
    const lines = wrap(text, 105);
    this.need(Math.min(lines.length, 6), 10);
    for (const l of lines) {
      this.need(1, 10);
      this.text(l, LEFT, 8);
      this.down(10);
    }
    this.down(4);
  }
  /** headerRows: rows of column titles printed right-aligned at xs; rows: label then values */
  table(headerRows: string[][], xs: number[], rows: Row[], label = '') {
    this.need(headerRows.length + 2, 11);
    headerRows.forEach((hr, i) => {
      if (i === headerRows.length - 1 && label) this.text(label, LEFT, 8, true);
      hr.forEach((h, j) => this.right(h, xs[j + (xs.length - hr.length)] as number, 8, true));
      this.down(11);
    });
    for (const r of rows) {
      this.need(1, 11);
      this.text(r.l, LEFT, 8, !!r.b);
      if (r.v) r.v.forEach((v, j) => this.right(money(v, r.dp ? 4 : r.dp2 ? 2 : 0), xs[j] as number, 8, !!r.b));
      this.down(11);
    }
    this.down(6);
  }
}

async function pdfOf(doc: Doc, opts: { xs?: (b: Block) => number[]; headers?: (b: Block) => string[][] } = {}): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(doc.title);
  const w = new Writer(pdf, await pdf.embedFont(StandardFonts.Helvetica), await pdf.embedFont(StandardFonts.HelveticaBold));
  w.heading(doc.title, doc.meta);
  for (const b of doc.blocks) {
    if (b.k === 'head') w.heading(b.title as string, b.sub);
    else if (b.k === 'para') w.para(b.text as string);
    else if (b.k === 'table') {
      const cols = b.cols as string[];
      const xs =
        opts.xs?.(b) ?? (cols.length === 1 ? [520] : cols.length === 2 ? [440, 520] : cols.map((_, i) => 520 - (cols.length - 1 - i) * 75));
      w.table(opts.headers?.(b) ?? [cols], xs, b.rows as Row[], b.label || '');
    }
  }
  return pdf.save({ useObjectStreams: false });
}

function xlsxOf(sheets: { name: string; rows: unknown[][] }[]): Uint8Array {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s.rows), s.name);
  return new Uint8Array(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
}

const S = SampleFund;
const tbRows = (S.docs.tb.blocks.find((b) => b.k === 'table')?.rows || []) as Row[];
const tbWorkbook = () =>
  xlsxOf([
    {
      name: 'TB 31Dec2025',
      rows: [
        ['Meridian Global Equity Fund ICAV'],
        ['Trial balance as at 31 December 2025 (GBP)'],
        [],
        ['Account', 'Account name', 'Debit', 'Credit'],
        ...tbRows.filter((r) => !r.b).map((r) => [r.ref ?? '', r.l, r.v?.[0] ?? null, r.v?.[1] ?? null]),
        ['', 'Total', ...[0, 1].map((i) => tbRows.filter((r) => !r.b).reduce((a, r) => a + (r.v?.[i] || 0), 0))]
      ]
    }
  ]);
const isTables = S.docs.is.blocks.filter((b) => b.k === 'table');
const isWorkbook = () =>
  xlsxOf([
    {
      name: 'Summary',
      rows: [
        ['Custodian valuation report at 31 December 2025'],
        ['Fund: Meridian Global Equity Fund ICAV'],
        [],
        ['Asset class', 'Market value', '% of NAV'],
        ...((isTables[0]?.rows || []) as Row[]).filter((r) => !r.b).map((r) => [r.l, r.v?.[0] ?? null, r.v?.[1] ?? null]),
        ['Total', ((isTables[0]?.rows || []) as Row[]).filter((r) => !r.b).reduce((a, r) => a + (r.v?.[0] || 0), 0), null]
      ]
    },
    {
      name: 'Holdings',
      rows: [
        ['Ten largest holdings at 31 December 2025'],
        [],
        ['Security', 'Asset class', 'Level', 'Market value'],
        ...((isTables[1]?.rows || []) as Row[])
          .filter((r) => !r.b)
          .map((r, i) => [r.l, i < 3 ? 'Equities — North America' : 'Equities — Europe', i === 5 ? 'Level 2' : 'Level 1', r.v?.[0] ?? null])
      ]
    }
  ]);

// Umbrella accounts: two sub-funds side by side with a Total column, one planted total error.
function umbrellaDoc(base: Doc): Doc {
  const blocks: Block[] = base.blocks.map((b) => {
    if (b.k !== 'table' || (b.cols || []).length !== 2) return b;
    return {
      ...b,
      cols: ['Alpha Fund 2025', 'Alpha Fund 2024', 'Beta Fund 2025', 'Beta Fund 2024', 'Total 2025', 'Total 2024'],
      rows: (b.rows as Row[]).map((r) => {
        if (!r.v) return r;
        const alpha = r.v.slice(0, 2),
          beta = alpha.map((x) => (x == null ? null : Math.round(x / 2)));
        const total = alpha.map((x, i) =>
          x == null ? null : x + (beta[i] ?? 0) + (r.l === 'Cash and cash equivalents' && i === 0 ? 5000 : 0)
        );
        return { ...r, v: [alpha[0] ?? null, alpha[1] ?? null, beta[0] ?? null, beta[1] ?? null, total[0] ?? null, total[1] ?? null] };
      })
    };
  });
  return { ...base, title: 'Umbrella Fund ICAV: Draft Financial Statements', blocks };
}
const umbrellaPdf = (doc: Doc) =>
  pdfOf(doc, {
    xs: (b) =>
      (b.cols || []).length === 6 ? [270, 315, 375, 420, 480, 525] : (b.cols || []).length === 2 ? [440, 520] : [295, 370, 445, 520],
    headers: (b) =>
      (b.cols || []).length === 6
        ? [
            ['Alpha Fund', 'Beta Fund', 'Total'],
            ['2025', '2024', '2025', '2024', '2025', '2024']
          ]
        : [b.cols as string[]]
  });

// A scanned page: the first statement drawn as an image, so the PDF has no text layer.
async function scannedPdf(): Promise<Uint8Array> {
  const { createCanvas } = (await import('canvas')).default;
  const scale = 2;
  const canvas = createCanvas(W * scale, H * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000';
  let y = 80;
  const line = (cells: { x: number; s: string; right?: boolean; bold?: boolean }[], size = 9) => {
    for (const c of cells) {
      ctx.font = `${c.bold ? 'bold ' : ''}${size * scale}px Arial`;
      const w = ctx.measureText(c.s).width;
      ctx.fillText(c.s, c.right ? c.x * scale - w : c.x * scale, y * scale);
    }
    y += size + 6;
  };
  line([{ x: LEFT, s: 'Statement of Financial Position', bold: true }], 12);
  line([{ x: LEFT, s: 'As at 31 December · GBP' }]);
  const t = S.docs.cy.blocks[1] as Block;
  line([
    { x: LEFT, s: 'Assets', bold: true },
    { x: 440, s: '2025', right: true, bold: true },
    { x: 520, s: '2024', right: true, bold: true }
  ]);
  for (const r of t.rows as Row[]) {
    line([
      { x: LEFT, s: r.l.length > 60 ? r.l.slice(0, 60) : r.l, bold: !!r.b },
      ...(r.v || []).map((v, j) => ({ x: j ? 520 : 440, s: money(v, r.dp ? 4 : 0), right: true }))
    ]);
  }
  const png = canvas.toBuffer('image/png');
  const pdf = await PDFDocument.create();
  const img = await pdf.embedPng(png);
  const page = pdf.addPage([W, H]);
  page.drawImage(img, { x: 0, y: 0, width: W, height: H });
  return pdf.save();
}

async function main() {
  const put = (set: string, name: string, bytes: Uint8Array) => {
    mkdirSync(path.join(OUT, set), { recursive: true });
    writeFileSync(path.join(OUT, set, name), bytes);
    console.log(`${set}/${name}  ${bytes.length} bytes`);
  };
  put('meridian', 'cy.pdf', await pdfOf(S.docs.cy));
  put('meridian', 'py.pdf', await pdfOf(S.docs.py));
  put('meridian', 'tb.xlsx', tbWorkbook());
  put('meridian', 'is.xlsx', isWorkbook());
  put('meridian', 'sup.pdf', await pdfOf(S.docs.sup));
  put('meridian', 'cy-v3.pdf', await pdfOf(applyV3(S.docs.cy)));
  put('umbrella', 'cy.pdf', await umbrellaPdf(umbrellaDoc(S.docs.cy)));
  put('umbrella', 'py.pdf', await pdfOf(S.docs.py));
  put('scanned', 'cy.pdf', await scannedPdf());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
