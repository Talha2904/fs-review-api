// DocumentReader that parses every document in its own short-lived child process, with a memory limit and a
// timeout. pdf.js and SheetJS run untrusted input; in a separate process a bad file cannot block the api's event
// loop, use the api's heap, or leave anything behind (prototype pollution dies with the process). The parsing
// itself is PdfJsDocumentReader, so results are identical.
import { fork } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

import type { PdfContent, Sheet } from '@fs-review/shared/analysis';

import type { DocumentReader, PageImage } from '../../application/ports/DocumentReader.js';

import type { DocumentOp, DocumentReply } from './documentWorker.js';

export interface IsolationLimits {
  /** stop a read after this long (default 120 s) */
  timeoutMs?: number;
  /** the reading process's heap limit (default 768 MB) */
  maxHeapMb?: number;
}

const here = new URL(import.meta.url);
// Built: the compiled reader. From source (development and tests): the TypeScript file, loaded through tsx.
const fromSource = here.pathname.endsWith('.ts');
const workerPath = fileURLToPath(new URL(fromSource ? './documentWorker.ts' : './documentWorker.js', here));
// tsx by absolute address: the api may be started from another folder, where the bare name does not resolve
const tsxLoader = fromSource ? pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href : '';

export class IsolatedDocumentReader implements DocumentReader {
  constructor(private readonly limits: IsolationLimits = {}) {}

  pdfContent(bytes: Uint8Array): Promise<PdfContent> {
    return this.run('pdfContent', bytes) as Promise<PdfContent>;
  }
  pdfPageImages(bytes: Uint8Array): Promise<{ pages: PageImage[]; pageCount: number }> {
    return this.run('pdfPageImages', bytes) as Promise<{ pages: PageImage[]; pageCount: number }>;
  }
  xlsxSheets(bytes: Uint8Array): Promise<Sheet[]> {
    return this.run('xlsxSheets', bytes) as Promise<Sheet[]>;
  }
  xlsxText(bytes: Uint8Array): Promise<string> {
    return this.run('xlsxText', bytes) as Promise<string>;
  }

  private run(op: DocumentOp, bytes: Uint8Array): Promise<unknown> {
    const { timeoutMs = 120_000, maxHeapMb = 768 } = this.limits;
    return new Promise((resolve, reject) => {
      const child = fork(workerPath, [], {
        execArgv: [`--max-old-space-size=${maxHeapMb}`, ...(fromSource ? ['--import', tsxLoader] : [])],
        serialization: 'advanced', // binary data travels as is, not as JSON
        stdio: ['ignore', 'ignore', 'pipe', 'ipc']
      });
      let stderr = '';
      child.stderr?.on('data', (d: Buffer) => (stderr = (stderr + d.toString()).slice(-2000)));
      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (child.exitCode === null) child.kill();
        fn();
      };
      const timer = setTimeout(() => finish(() => reject(new Error('Reading the document took too long.'))), timeoutMs);
      child.once('message', (m: DocumentReply) => finish(() => (m.ok ? resolve(m.result) : reject(new Error(m.error)))));
      child.once('error', (e) => finish(() => reject(new Error(`The document could not be read: ${e.message}`))));
      child.once('exit', (code) =>
        finish(() =>
          reject(
            new Error(
              /heap out of memory|allocation failed/i.test(stderr)
                ? 'The document is too large to read.'
                : `The document could not be read (the reader stopped with code ${code}). ${stderr.trim().split('\n').slice(-3).join(' ')}`.trim()
            )
          )
        )
      );
      child.send({ op, bytes });
    });
  }
}
