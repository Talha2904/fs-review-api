// DocumentReader with pdf.js (legacy build, the one that runs in Node) and SheetJS, at the same versions
// as the web app, so a document's text and positions come out exactly as they did in the browser.
// Pages are drawn for OCR with node-canvas, which pdf.js uses for its own canvases in Node.
import { createRequire } from 'node:module';

import { layoutLines, type PdfContent, type PdfTextItem, type Sheet } from '@fs-review/shared/analysis';

import type { DocumentReader, PageImage } from '../../application/ports/DocumentReader.js';

const require = createRequire(import.meta.url);

// The libraries are CommonJS; loading them through require keeps one copy and avoids interop surprises.
interface PdfPage {
  getViewport(o: { scale: number }): { width: number; height: number };
  getTextContent(): Promise<{ items: PdfTextItem[] }>;
  render(o: { canvasContext: unknown; viewport: unknown }): { promise: Promise<void> };
  cleanup(): void;
}
interface PdfDoc {
  numPages: number;
  getPage(n: number): Promise<PdfPage>;
  destroy(): Promise<void>;
}
interface PdfJs {
  getDocument(o: Record<string, unknown>): { promise: Promise<PdfDoc> };
}
interface SheetJs {
  read(data: ArrayBuffer, o?: Record<string, unknown>): { SheetNames: string[]; Sheets: Record<string, unknown> };
  utils: {
    sheet_to_json(ws: unknown, o: Record<string, unknown>): unknown[][];
    sheet_to_csv(ws: unknown, o: Record<string, unknown>): string;
  };
}
interface NodeCanvas {
  createCanvas(
    w: number,
    h: number
  ): {
    width: number;
    height: number;
    getContext(kind: '2d'): { fillStyle: string; fillRect(x: number, y: number, w: number, h: number): void };
    toBuffer(mime: 'image/png'): Buffer;
  };
}

let pdfjs: PdfJs | null = null;
const loadPdfjs = (): PdfJs => (pdfjs ??= require('pdfjs-dist/legacy/build/pdf.js') as PdfJs);
const loadXlsx = (): SheetJs => require('xlsx') as SheetJs;
/** node-canvas is an optional dependency (a native module). Without it scans cannot be drawn for OCR, and the
 * analysis falls back to reading them with AI where that is allowed. */
export const canDrawPages = (): boolean => {
  try {
    require.resolve('canvas');
    return true;
  } catch {
    return false;
  }
};
const loadCanvas = (): NodeCanvas => {
  if (!canDrawPages()) throw new Error('Drawing scanned pages needs the optional canvas package, which is not installed on this server.');
  return require('canvas') as NodeCanvas;
};

/** A copy of the bytes as a standalone ArrayBuffer, the form the browser handed to both libraries. */
const arrayBufferOf = (bytes: Uint8Array): ArrayBuffer => bytes.slice().buffer as ArrayBuffer;

// isEvalSupported: false as in the browser (no generated code); verbosity 0 keeps font warnings out of the logs.
const open = (bytes: Uint8Array) => loadPdfjs().getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, verbosity: 0 }).promise;

/** An A4 page at scale 2 is about 2 million pixels; a page is never drawn larger than ten times that. */
const MAX_PAGE_PIXELS = 20_000_000;

export class PdfJsDocumentReader implements DocumentReader {
  async pdfContent(bytes: Uint8Array, maxPages = 80): Promise<PdfContent> {
    const doc = await open(bytes);
    try {
      const pages: string[] = [],
        lines: PdfContent['lines'] = [];
      for (let i = 1; i <= Math.min(doc.numPages, maxPages); i++) {
        const page = await doc.getPage(i),
          vp = page.getViewport({ scale: 1 }),
          tc = await page.getTextContent();
        pages.push(tc.items.map((it) => (it.str ?? '') + (it.hasEOL ? '\n' : ' ')).join(''));
        lines.push(...layoutLines(tc.items, i, vp.width, vp.height));
        page.cleanup();
      }
      return { text: pages.join('\n'), pageCount: doc.numPages, lines };
    } finally {
      await doc.destroy();
    }
  }

  async pdfPageImages(bytes: Uint8Array, { maxPages = 60, scale = 2 }: { maxPages?: number; scale?: number } = {}) {
    const { createCanvas } = loadCanvas();
    const doc = await open(bytes);
    try {
      const pages: PageImage[] = [];
      for (let i = 1; i <= Math.min(doc.numPages, maxPages); i++) {
        const page = await doc.getPage(i),
          vp1 = page.getViewport({ scale: 1 });
        // a page with a huge declared size is drawn smaller, so one page cannot claim gigabytes of canvas
        const pageScale = Math.min(scale, Math.sqrt(MAX_PAGE_PIXELS / Math.max(1, vp1.width * vp1.height)));
        const vp = page.getViewport({ scale: pageScale });
        const canvas = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        pages.push({ png: new Uint8Array(canvas.toBuffer('image/png')), width: vp1.width, height: vp1.height, scale: pageScale });
        page.cleanup();
      }
      return { pages, pageCount: doc.numPages };
    } finally {
      await doc.destroy();
    }
  }

  async xlsxSheets(bytes: Uint8Array): Promise<Sheet[]> {
    const XLSX = loadXlsx();
    const wb = XLSX.read(arrayBufferOf(bytes), { cellDates: true });
    return wb.SheetNames.map((name) => ({
      name,
      rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, blankrows: false })
    }));
  }

  async xlsxText(bytes: Uint8Array): Promise<string> {
    const XLSX = loadXlsx();
    const wb = XLSX.read(arrayBufferOf(bytes));
    return wb.SheetNames.map((n) => `## Sheet: ${n}\n` + XLSX.utils.sheet_to_csv(wb.Sheets[n], { blankrows: false })).join('\n\n');
  }
}
