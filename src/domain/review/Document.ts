// Document versions: every upload is a numbered version of one of the five slots. A document's identity
// is its content fingerprint (SHA-256), never its file name. Built-in samples have no file.
import { extOf, SLOT_RULES, type Slot } from '@fs-review/shared';

export interface Person {
  id: string;
  name: string;
  role: string;
}

export type ValidationStatus = 'checking' | 'recognised' | 'check' | 'mismatch' | 'sample';

export interface Validation {
  status: ValidationStatus;
  recognisedAs?: string | null;
  confidence?: string | null;
  period?: string | null;
  summary: string;
  checks: unknown[];
  checkedAt?: string;
  localReadable?: boolean;
  ocrLow?: number;
  [extra: string]: unknown;
}

export interface Confirmation {
  by: Person | null;
  at: string;
  reason: string;
}

export interface DocumentVersion {
  id: string;
  engagementId: string;
  slot: Slot;
  version: number;
  fileName: string;
  size: number;
  sha256: string;
  sample: boolean;
  storageKey: string | null;
  uploadedBy: Person | null;
  uploadedAt: string;
  removedAt: string | null;
  removedBy: Person | null;
  validation: Validation | null;
  confirmation: Confirmation | null;
  readWith: string | null;
  readWithBy: Person | null;
  readWithAt: string | null;
  sameAs: number | null;
}

/** What the screens receive: the same record without the storage key. */
export type DocumentVersionView = Omit<DocumentVersion, 'storageKey'>;
export const viewOf = (v: DocumentVersion): DocumentVersionView => {
  const { storageKey: _k, ...rest } = v;
  return rest;
};

export const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46]; // %PDF
export const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]; // PK.. (an .xlsx is a zip)

const startsWith = (bytes: Uint8Array, magic: number[]) => magic.every((b, i) => bytes[i] === b);

/** The first problem with an upload for this slot, or an empty string. Mirrors the web app's own check. */
export function uploadProblem(slot: Slot, fileName: string, bytes: Uint8Array, maxBytes: number): string {
  const rule = SLOT_RULES[slot];
  const ext = extOf(fileName);
  if (ext !== rule.type) return `This document must be ${rule.label}; “${fileName}” is not.`;
  if (!bytes.length) return `“${fileName}” is empty.`;
  if (bytes.length > maxBytes) return `“${fileName}” is larger than ${Math.round(maxBytes / 1048576)} MB.`;
  if (rule.type === 'pdf' && !startsWith(bytes, PDF_MAGIC)) return `“${fileName}” is not a PDF.`;
  if (rule.type === 'xlsx' && !startsWith(bytes, ZIP_MAGIC)) return `“${fileName}” is not an Excel (.xlsx) workbook.`;
  return '';
}

export const contentTypeFor = (slot: Slot): string =>
  SLOT_RULES[slot].type === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** What makes two versions "the same document": the fingerprint, or the sample name for built-in samples. */
export const contentKey = (v: Pick<DocumentVersion, 'sha256' | 'sample' | 'fileName' | 'id'> | null | undefined): string | null =>
  v ? v.sha256 || (v.sample ? 'sample:' + v.fileName : 'id:' + v.id) : null;

/** A document counts as cleared for review when recognised, a sample, confirmed by a person, or read with AI by choice. */
export const isCleared = (v: DocumentVersion | null | undefined): boolean =>
  !!v && (v.validation?.status === 'recognised' || v.validation?.status === 'sample' || !!v.confirmation || v.readWith === 'ai');

export const REQUIRED_SLOTS: readonly Slot[] = ['cy', 'py', 'tb', 'is'];

/**
 * The version each slot shows now: its latest version, unless that latest version was removed (then the
 * slot is empty, as the screens show it). One rule for attaching, removing, marking ready, analysing and
 * signing off.
 */
export function currentVersions(all: readonly DocumentVersion[]): Partial<Record<Slot, DocumentVersion>> {
  const sorted = [...all].sort((a, b) => a.version - b.version || a.uploadedAt.localeCompare(b.uploadedAt));
  const current: Partial<Record<Slot, DocumentVersion>> = {};
  for (const v of sorted) current[v.slot] = v;
  for (const slot of Object.keys(current) as Slot[]) if (current[slot]?.removedAt) delete current[slot];
  return current;
}
export const currentVersion = (all: readonly DocumentVersion[], slot: Slot): DocumentVersion | null => currentVersions(all)[slot] ?? null;

/** The slots whose content differs between the versions an analysis read and what is attached now. */
export function changedSince(all: readonly DocumentVersion[], read: Record<string, string> | null | undefined): Slot[] {
  const byId = new Map(all.map((v) => [v.id, v]));
  const current = currentVersions(all);
  const before = Object.fromEntries(Object.entries(read ?? {}).map(([k, id]) => [k, byId.get(id) ?? null])) as Partial<
    Record<Slot, DocumentVersion | null>
  >;
  const slots = [...new Set([...Object.keys(before), ...Object.keys(current)])] as Slot[];
  return slots.filter((k) => contentKey(before[k]) !== contentKey(current[k]));
}
