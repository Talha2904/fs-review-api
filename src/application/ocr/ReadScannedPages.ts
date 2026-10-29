import type { PermissionMatrix } from '@fs-review/shared';

import { validationFailed } from '../../domain/errors.js';
import type { Actor } from '../../domain/identity/User.js';
import type { ActivityRecorder } from '../activity/ActivityRecorder.js';
import { requireAnyPermission } from '../identity/authorize.js';
import { OCR_MAX_PAGE_BYTES, OCR_MAX_PAGES, type OcrEngine, type OcrPage } from '../ports/OcrEngine.js';

export interface OcrInput {
  pages: { png: string }[];
  fileName?: string;
  engagementId?: string | null;
  fundName?: string | null;
}

/** Scanned PDFs read on this server with Tesseract: no AI, nothing leaves the server. */
export class ReadScannedPages {
  constructor(
    private readonly engine: OcrEngine,
    private readonly activity: ActivityRecorder
  ) {}

  async execute(actor: Actor | null, matrix: PermissionMatrix, input: OcrInput, ip?: string): Promise<{ pages: OcrPage[] }> {
    const by = requireAnyPermission(actor, ['documents.attach', 'analysis.run'], matrix, 'Your role cannot read documents.');
    const pages = Array.isArray(input.pages) ? input.pages : [];
    if (!pages.length || pages.length > OCR_MAX_PAGES) throw validationFailed(`Send between 1 and ${OCR_MAX_PAGES} pages.`);
    const t0 = Date.now();
    const out: OcrPage[] = [];
    for (const p of pages) {
      const buf = Buffer.from(String(p.png || ''), 'base64');
      if (!buf.length) throw validationFailed('A page image is missing.');
      if (buf.length > OCR_MAX_PAGE_BYTES) throw validationFailed('A page image is too large to read.');
      out.push(await this.engine.readPage(buf));
    }
    await this.activity.record({
      actor: by,
      category: 'Documents',
      summary: `Read ${pages.length} scanned page${pages.length === 1 ? '' : 's'} with OCR`,
      details: `${input.fileName || ''} · ${Date.now() - t0} ms · no AI`,
      ip: ip ?? '',
      engagementId: input.engagementId ?? null,
      fundName: input.fundName ?? null
    });
    return { pages: out };
  }
}
