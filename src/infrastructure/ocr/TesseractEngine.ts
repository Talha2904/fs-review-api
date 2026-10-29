import { createRequire } from 'node:module';
import path from 'node:path';

import { createWorker, type Worker } from 'tesseract.js';

import type { OcrEngine, OcrPage } from '../../application/ports/OcrEngine.js';

/**
 * Tesseract on this server: open source, no AI, nothing leaves the machine. English language data is
 * installed with the api (@tesseract.js-data/eng), so it works offline. One worker, one page at a time.
 */
const PAGE_TIMEOUT_MS = 90_000;
const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Reading the scanned page took too long.')), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e: unknown) => (clearTimeout(t), reject(e))
    );
  });

export class TesseractEngine implements OcrEngine {
  private worker: Promise<Worker> | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly cachePath: string) {}

  private getWorker(): Promise<Worker> {
    if (!this.worker) {
      const require = createRequire(import.meta.url);
      const langPath = path.join(path.dirname(require.resolve('@tesseract.js-data/eng/package.json')), '4.0.0_best_int');
      this.worker = createWorker('eng', 1, { langPath, gzip: true, cachePath: this.cachePath });
    }
    return this.worker;
  }

  readPage(png: Uint8Array): Promise<OcrPage> {
    // serialised across all requests so the server stays responsive; a page that takes too long, or a worker
    // that fails, is dropped and the next page starts a fresh worker
    const run = this.queue.then(() =>
      withTimeout(this.recognise(png), PAGE_TIMEOUT_MS).catch(async (e: unknown) => {
        await this.close().catch(() => undefined);
        throw e;
      })
    );
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async recognise(png: Uint8Array): Promise<OcrPage> {
    const w = await this.getWorker();
    const { data } = await w.recognize(Buffer.from(png), {}, { blocks: true });
    const lines = (data.blocks || [])
      .flatMap((b) => b.paragraphs.flatMap((p) => p.lines))
      .map((l) => ({
        words: l.words
          .filter((x) => x.text.trim())
          .map((x) => ({ text: x.text, x0: x.bbox.x0, x1: x.bbox.x1, y0: x.bbox.y0, y1: x.bbox.y1, conf: Math.round(x.confidence) }))
      }))
      .filter((l) => l.words.length);
    return { lines, confidence: Math.round(data.confidence || 0) };
  }

  async close(): Promise<void> {
    const w = this.worker;
    this.worker = null;
    if (w) await (await w).terminate();
  }
}
