// Positioned text lines, the common input of the PDF readers. A digitally produced PDF gives its text
// items with positions (pdf.js); a scanned PDF gives OCR words with positions. Both become the same
// lines of cells, so one reader rebuilds the tables either way. No AI.
import type { PdfContent, PdfLine } from '../types.js';

/** A text item as pdf.js returns it: the string and its transform (x = [4], y = [5], height = [3]). */
export interface PdfTextItem {
  str?: string;
  transform: number[];
  width?: number;
  height?: number;
  hasEOL?: boolean;
}

/** Groups a page's text items into lines (by baseline) of cells sorted left to right, top line first. */
export function layoutLines(items: PdfTextItem[], page: number, pageWidth: number, pageHeight: number): PdfLine[] {
  const rows: PdfLine[] = [];
  for (const it of items) {
    const str = (it.str || '').trim();
    if (!str) continue;
    const x = it.transform[4] as number,
      y = it.transform[5] as number,
      h = Math.abs(it.transform[3] as number) || it.height || 10;
    let row = rows.find((r) => Math.abs(r.y - y) <= Math.max(2, h * 0.3));
    if (!row) rows.push((row = { page, y, height: h, pageWidth, pageHeight, cells: [] }));
    row.cells.push({ x, x2: x + (it.width || 0), str });
  }
  rows.forEach((r) => r.cells.sort((a, b) => a.x - b.x));
  return rows.sort((a, b) => b.y - a.y);
}

/** A PDF with almost no text layer is a scan. */
export const isScanned = (content: Pick<PdfContent, 'text'> | null | undefined): boolean =>
  (content?.text || '').replace(/\s/g, '').length < 120;

/** OCR artefacts: stray underscores and bars, and letters misread inside numbers (O→0, l/I→1, S→5). */
export function cleanToken(t: unknown): string {
  let s = String(t).replace(/^[_|'`‘’"“”~]+|[_|'`‘’"“”~]+$/g, '');
  if (/^[—–-]+$/.test(s)) return '—';
  const core = s.replace(/[(),.£$€%-]/g, '');
  if (core && /\d/.test(core) && /^[\dOolIS]+$/.test(core)) s = s.replace(/[Oo]/g, '0').replace(/[lI]/g, '1').replace(/S/g, '5');
  // a full stop between groups of three digits is a misread thousands comma: 5.500,000 → 5,500,000
  if (/^\(?-?\d{1,3}([.,]\d{3})+\)?$/.test(s) && (s.match(/[.,]/g) || []).length > 1) s = s.replace(/\./g, ',');
  return s;
}

export interface OcrWordBox {
  text: string;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}
export interface OcrPageWords {
  lines: { words: OcrWordBox[] }[];
  confidence: number;
}
/** Each OCR page's size in PDF points and the scale it was drawn at. */
export interface PageMeta {
  width: number;
  height: number;
  scale: number;
}

/** Words on one OCR line become cells: a gap wider than about two characters starts a new cell. */
export function ocrLines(ocrPages: OcrPageWords[], meta: PageMeta[]): PdfLine[] {
  const lines: PdfLine[] = [];
  ocrPages.forEach((pg, i) => {
    const { width, height, scale } = meta[i] as PageMeta;
    for (const l of pg.lines) {
      const ws = l.words
        .map((w) => ({ ...w, text: cleanToken(w.text) }))
        .filter((w) => w.text)
        .sort((a, b) => a.x0 - b.x0);
      if (!ws.length || ws.every((w) => /^[^A-Za-z0-9]+$/.test(w.text))) continue; // a line of specks or rules
      const charW = ws.reduce((a, w) => a + (w.x1 - w.x0) / Math.max(1, w.text.length), 0) / ws.length;
      const cells: { str: string; left: number; right: number }[] = [];
      for (const w of ws) {
        const last = cells[cells.length - 1];
        if (last && w.x0 - last.right <= charW * 2.2) {
          last.str += ' ' + w.text;
          last.right = w.x1;
        } else cells.push({ str: w.text, left: w.x0, right: w.x1 });
      }
      const y0 = Math.min(...ws.map((w) => w.y0)),
        y1 = Math.max(...ws.map((w) => w.y1));
      lines.push({
        page: i + 1,
        y: height - y1 / scale,
        height: (y1 - y0) / scale,
        pageWidth: width,
        pageHeight: height,
        cells: cells.map((c) => ({ x: c.left / scale, x2: c.right / scale, str: c.str }))
      });
    }
  });
  return lines.sort((a, b) => a.page - b.page || b.y - a.y);
}

/** OCR pages turned into the same content shape as a PDF's text layer, with the OCR confidence. */
export function ocrContent(pages: OcrPageWords[], meta: PageMeta[], pageCount: number): PdfContent {
  const lines = ocrLines(pages, meta);
  return {
    text: lines.map((l) => l.cells.map((c) => c.str).join(' ')).join('\n'),
    lines,
    pageCount,
    ocr: { pages: pages.length, confidence: Math.round(pages.reduce((a, p) => a + p.confidence, 0) / (pages.length || 1)) }
  };
}
