// The api reads untrusted documents in separate processes (IsolatedDocumentReader): the same results as reading in
// process, and a read that runs too long is stopped without affecting the api.
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { IsolatedDocumentReader } from '../../src/infrastructure/documents/IsolatedDocumentReader.js';
import { PdfJsDocumentReader } from '../../src/infrastructure/documents/PdfJsDocumentReader.js';
import { FIXTURES } from '../fixtures/analysis/scenarios.js';

const file = (f: string) => new Uint8Array(readFileSync(path.join(FIXTURES, f)));

describe('reading documents in a separate process', () => {
  it('gives exactly what reading in process gives, for PDFs and workbooks', async () => {
    const isolated = new IsolatedDocumentReader({});
    const local = new PdfJsDocumentReader();
    expect(await isolated.pdfContent(file('meridian/cy.pdf'))).toEqual(await local.pdfContent(file('meridian/cy.pdf')));
    expect(await isolated.xlsxSheets(file('meridian/tb.xlsx'))).toEqual(await local.xlsxSheets(file('meridian/tb.xlsx')));
    expect(await isolated.xlsxText(file('meridian/is.xlsx'))).toEqual(await local.xlsxText(file('meridian/is.xlsx')));
  }, 60_000);

  it('draws a scanned page for OCR (node-canvas loads in the reading process)', async () => {
    const { pages, pageCount } = await new IsolatedDocumentReader({}).pdfPageImages(file('scanned/cy.pdf'));
    expect(pageCount).toBe(1);
    expect(pages[0]).toMatchObject({ width: 595, height: 842, scale: 2 });
    expect(pages[0]!.png.slice(1, 4)).toEqual(new Uint8Array([0x50, 0x4e, 0x47])); // PNG
  }, 60_000);

  it('stops a read that takes too long, and reports a file that is not a document', async () => {
    await expect(new IsolatedDocumentReader({ timeoutMs: 1 }).pdfContent(file('meridian/cy.pdf'))).rejects.toThrow(
      'Reading the document took too long.'
    );
    await expect(new IsolatedDocumentReader({}).pdfContent(new TextEncoder().encode('not a pdf'))).rejects.toThrow();
  }, 60_000);
});
