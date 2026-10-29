// Reads the text inside a document, entirely in the browser, with no AI.
// PDFs use pdf.js (Mozilla's open-source PDF reader); spreadsheets use SheetJS.
import * as XLSX from 'xlsx';

let pdfjsReady;
function loadPdfjs() {
  if (!pdfjsReady) pdfjsReady = (async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf');
    // Registering the worker code on the page makes pdf.js parse on the main thread, so no
    // separate worker file has to be served (works in a single-file page and under strict CSP).
    globalThis.pdfjsWorker = await import('pdfjs-dist/legacy/build/pdf.worker');
    return pdfjs;
  })();
  return pdfjsReady;
}

// Returns the plain text and, for reading tables, every line with its cells and their positions:
// lines: [{ page, y, height, pageHeight, pageWidth, cells: [{ x, x2, str }] }] in reading order.
export async function pdfText(file, maxPages = 80) {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
  const pages = [], lines = [];
  for (let i = 1; i <= Math.min(doc.numPages, maxPages); i++) {
    const page = await doc.getPage(i), vp = page.getViewport({ scale: 1 }), tc = await page.getTextContent();
    pages.push(tc.items.map(it => it.str + (it.hasEOL ? '\n' : ' ')).join(''));
    lines.push(...layoutLines(tc.items, i, vp.width, vp.height));
  }
  const pageCount = doc.numPages; await doc.destroy();
  return { text: pages.join('\n'), pageCount, lines };
}
// Draws each page of a PDF as a PNG image (for OCR), at `scale` times its size.
export async function pdfPageImages(file, { maxPages = 60, scale = 2 } = {}) {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
  const pages = [];
  for (let i = 1; i <= Math.min(doc.numPages, maxPages); i++) {
    const page = await doc.getPage(i), vp1 = page.getViewport({ scale: 1 }), vp = page.getViewport({ scale });
    const canvas = document.createElement('canvas'); canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    pages.push({ png: canvas.toDataURL('image/png').split(',')[1], width: vp1.width, height: vp1.height, scale });
  }
  const pageCount = doc.numPages; await doc.destroy();
  return { pages, pageCount };
}

export function layoutLines(items, page, pageWidth, pageHeight) {
  const rows = [];
  for (const it of items) {
    const str = (it.str || '').trim(); if (!str) continue;
    const x = it.transform[4], y = it.transform[5], h = Math.abs(it.transform[3]) || it.height || 10;
    let row = rows.find(r => Math.abs(r.y - y) <= Math.max(2, h * 0.3));
    if (!row) rows.push(row = { page, y, height: h, pageWidth, pageHeight, cells: [] });
    row.cells.push({ x, x2: x + (it.width || 0), str });
  }
  rows.forEach(r => r.cells.sort((a, b) => a.x - b.x));
  return rows.sort((a, b) => b.y - a.y);
}

// Every sheet as rows of cells (values, not formulas) plus one plain-text version for keyword search.
export async function xlsxContent(file) {
  const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true });
  const sheets = wb.SheetNames.map(name => ({ name, rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, blankrows: false }) }));
  const text = sheets.map(s => `${s.name}\n` + s.rows.map(r => r.map(c => (c instanceof Date ? c.toISOString().slice(0, 10) : c ?? '')).join(' | ')).join('\n')).join('\n\n');
  return { sheets, text };
}

export async function sha256(file) {
  const buf = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
