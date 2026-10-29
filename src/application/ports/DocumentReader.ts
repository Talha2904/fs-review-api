import type { PdfContent, Sheet } from '@fs-review/shared/analysis';

/** One PDF page drawn as a PNG for OCR, with the page's size in PDF points and the scale it was drawn at. */
export interface PageImage {
  png: Uint8Array;
  width: number;
  height: number;
  scale: number;
}

/**
 * Reads the text inside documents, with no AI: a PDF's text layer with positions, a PDF's pages as
 * images (for OCR of scans), and a workbook's sheets. The adapter uses the same libraries and versions
 * as the web app (pdf.js and SheetJS), so the server reads a document exactly as the browser did.
 */
export interface DocumentReader {
  /** Plain text and positioned lines of the first `maxPages` pages. */
  pdfContent(bytes: Uint8Array, maxPages?: number): Promise<PdfContent>;
  /** Each page drawn as a PNG at `scale` times its size. */
  pdfPageImages(bytes: Uint8Array, opts?: { maxPages?: number; scale?: number }): Promise<{ pages: PageImage[]; pageCount: number }>;
  /** Every sheet as rows of cell values (dates as dates), for the app's own readers. */
  xlsxSheets(bytes: Uint8Array): Promise<Sheet[]>;
  /** Every sheet flattened to CSV under a "## Sheet:" heading, the form a workbook is sent to AI in. */
  xlsxText(bytes: Uint8Array): Promise<string>;
}
