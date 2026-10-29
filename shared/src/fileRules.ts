// Which file type each document slot accepts. Shared by the web app (checks before attaching) and the
// api (checks again before storing or sending anything to Claude), so the two can never disagree.

export const MAX_MB = 25;
export const MAX_BYTES = MAX_MB * 1048576;

export const SLOTS = ['cy', 'py', 'tb', 'is', 'sup'] as const;
export type Slot = (typeof SLOTS)[number];
export type FileKind = 'pdf' | 'xlsx';

export const SLOT_RULES: Record<Slot, { type: FileKind; label: string }> = {
  cy: { type: 'pdf', label: 'PDF' },
  py: { type: 'pdf', label: 'PDF' },
  tb: { type: 'xlsx', label: 'Excel (.xlsx)' },
  is: { type: 'xlsx', label: 'Excel (.xlsx)' },
  sup: { type: 'pdf', label: 'PDF' }
};

export const ACCEPT: Record<FileKind, string> = {
  pdf: '.pdf,application/pdf',
  xlsx: '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
};

const EXT_NAMES: Record<string, string> = {
  pdf: 'a PDF',
  xlsx: 'an Excel (.xlsx) file',
  xls: 'an older Excel (.xls) file',
  csv: 'a CSV file',
  docx: 'a Word document',
  doc: 'a Word document',
  png: 'an image',
  jpg: 'an image',
  jpeg: 'an image'
};

export const extOf = (name: unknown): string => (String(name ?? '').match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
export const describeExt = (ext: string): string => EXT_NAMES[ext] || (ext ? `a .${ext} file` : 'a file with no extension');
export const isSlot = (s: unknown): s is Slot => typeof s === 'string' && (SLOTS as readonly string[]).includes(s);
