// A scanned PDF on the server (UAT I3): the page is drawn with pdf.js and node-canvas, read with
// Tesseract (no AI), turned into positioned lines, and the statements reader finds the figures in it.
// Uses the real OCR engine and its bundled English data, so it takes a few seconds.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { isScanned, layoutBlocks, ocrContent, statementFigures } from '@fs-review/shared/analysis';

import { canDrawPages, PdfJsDocumentReader } from '../../src/infrastructure/documents/PdfJsDocumentReader.js';
import { TesseractEngine } from '../../src/infrastructure/ocr/TesseractEngine.js';
import { FIXTURES } from '../fixtures/analysis/scenarios.js';

// node-canvas is optional; where it is not installed the server reads scans with AI instead, so skip.
describe.skipIf(!canDrawPages())('a scanned draft read with OCR on the server', () => {
  const cache = mkdtempSync(path.join(tmpdir(), 'fsr-ocr-'));
  const engine = new TesseractEngine(cache);
  afterAll(async () => {
    await engine.close();
    rmSync(cache, { recursive: true, force: true });
  });

  it('has no text layer, is drawn and read, and gives the statement of financial position figures', async () => {
    const reader = new PdfJsDocumentReader();
    const bytes = new Uint8Array(readFileSync(path.join(FIXTURES, 'scanned/cy.pdf')));
    expect(isScanned(await reader.pdfContent(bytes))).toBe(true);

    const { pages, pageCount } = await reader.pdfPageImages(bytes);
    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatchObject({ width: 595, height: 842, scale: 2 });
    const read = [];
    for (const p of pages) read.push(await engine.readPage(p.png));
    const content = ocrContent(read, pages, pageCount);
    expect(content.ocr?.confidence).toBeGreaterThan(70);

    const F = statementFigures(layoutBlocks(content.lines));
    expect(F.statedTA).toBe(505050012);
    expect(F.statedNA).toBe(498430732);
    expect(F.ca).toEqual([486214905, 12480331, 3150000, 1204776, 2000000]);
  }, 90_000);
});
