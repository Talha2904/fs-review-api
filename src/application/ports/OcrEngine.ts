export interface OcrWord {
  text: string;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  conf: number;
}

export interface OcrPage {
  lines: { words: OcrWord[] }[];
  confidence: number;
}

/** Reads one page image (PNG bytes) into words with positions. Adapters run one page at a time. */
export interface OcrEngine {
  readPage(png: Uint8Array): Promise<OcrPage>;
}

export const OCR_MAX_PAGES = 60;
export const OCR_MAX_PAGE_BYTES = 8 * 1048576;
