// Runs in a child process started by IsolatedDocumentReader: one document read per process. Untrusted PDFs and
// workbooks are parsed here, away from the api's own heap and event loop, so a hostile or broken file can only
// exhaust this process's memory limit or be stopped by the timeout. (A child process rather than a worker
// thread, because node-canvas, which draws scanned pages, cannot load in worker threads.)
import { PdfJsDocumentReader } from './PdfJsDocumentReader.js';

export type DocumentOp = 'pdfContent' | 'pdfPageImages' | 'xlsxSheets' | 'xlsxText';
export interface DocumentRequest {
  op: DocumentOp;
  bytes: Uint8Array;
}
export type DocumentReply = { ok: true; result: unknown } | { ok: false; error: string };

const reader = new PdfJsDocumentReader();

process.once('message', async (m: DocumentRequest) => {
  let reply: DocumentReply;
  try {
    const bytes = new Uint8Array(m.bytes);
    const result =
      m.op === 'pdfContent'
        ? await reader.pdfContent(bytes)
        : m.op === 'pdfPageImages'
          ? await reader.pdfPageImages(bytes)
          : m.op === 'xlsxSheets'
            ? await reader.xlsxSheets(bytes)
            : await reader.xlsxText(bytes);
    reply = { ok: true, result };
  } catch (e) {
    reply = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  process.send?.(reply, () => process.exit(0));
});
