// Scanned PDFs: the pages are drawn as images here and read with OCR on the app's server (Tesseract,
// no AI). The words come back with positions and are turned into the same lines and cells as a
// digitally produced PDF, so the same reader rebuilds the tables. Results are kept per file content.
import { pdfPageImages } from './docText';

const cache = new Map(); // sha256 -> content
export const isScanned = content => (content?.text || '').replace(/\s/g, '').length < 120;
export const cachedOcr = sha => (sha ? cache.get(sha) || null : null);

// OCR artefacts: stray underscores and bars, and letters misread inside numbers (O→0, l/I→1, S→5).
export function cleanToken(t) {
  let s = String(t).replace(/^[_|'`‘’"“”~]+|[_|'`‘’"“”~]+$/g, '');
  if (/^[—–-]+$/.test(s)) return '—';
  const core = s.replace(/[(),.£$€%-]/g, '');
  if (core && /\d/.test(core) && /^[\dOolIS]+$/.test(core)) s = s.replace(/[Oo]/g, '0').replace(/[lI]/g, '1').replace(/S/g, '5');
  // a full stop between groups of three digits is a misread thousands comma: 5.500,000 → 5,500,000
  if (/^\(?-?\d{1,3}([.,]\d{3})+\)?$/.test(s) && (s.match(/[.,]/g) || []).length > 1) s = s.replace(/\./g, ',');
  return s;
}
// Words on one OCR line become cells: a gap wider than about two characters starts a new cell.
export function ocrLines(ocrPages, meta) {
  const lines = [];
  ocrPages.forEach((pg, i) => {
    const { width, height, scale } = meta[i];
    for (const l of pg.lines) {
      const ws = l.words.map(w => ({ ...w, text: cleanToken(w.text) })).filter(w => w.text).sort((a, b) => a.x0 - b.x0);
      if (!ws.length || ws.every(w => /^[^A-Za-z0-9]+$/.test(w.text))) continue;   // a line of specks or rules
      const charW = ws.reduce((a, w) => a + (w.x1 - w.x0) / Math.max(1, w.text.length), 0) / ws.length;
      const cells = [];
      for (const w of ws) {
        const last = cells[cells.length - 1];
        if (last && w.x0 - last.right <= charW * 2.2) { last.str += ' ' + w.text; last.right = w.x1; }
        else cells.push({ str: w.text, left: w.x0, right: w.x1 });
      }
      const y0 = Math.min(...ws.map(w => w.y0)), y1 = Math.max(...ws.map(w => w.y1));
      lines.push({ page: i + 1, y: height - y1 / scale, height: (y1 - y0) / scale, pageWidth: width, pageHeight: height,
        cells: cells.map(c => ({ x: c.left / scale, x2: c.right / scale, str: c.str })) });
    }
  });
  return lines.sort((a, b) => (a.page - b.page) || (b.y - a.y));
}

// post: the app's API helper for the OCR route. Pages go in small batches.
export async function ocrPdf(file, { sha256 = '', post, onProgress } = {}) {
  if (sha256 && cache.has(sha256)) return cache.get(sha256);
  const { pages, pageCount } = await pdfPageImages(file);
  const out = [];
  for (let i = 0; i < pages.length; i += 3) {
    onProgress?.(i, pages.length);
    const r = await post('/api/ocr', { fileName: file.name, pages: pages.slice(i, i + 3).map(p => ({ png: p.png })) });
    out.push(...r.pages);
  }
  const lines = ocrLines(out, pages);
  const content = { text: lines.map(l => l.cells.map(c => c.str).join(' ')).join('\n'), lines, pageCount, ocr: { pages: out.length, confidence: Math.round(out.reduce((a, p) => a + p.confidence, 0) / (out.length || 1)) } };
  if (sha256) cache.set(sha256, content);
  return content;
}
