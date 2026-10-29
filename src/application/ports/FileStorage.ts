/**
 * Object storage for uploaded documents, evidence and report PDFs. The database stores only the key,
 * size and SHA-256. Adapters: local disk for development, S3 protocol (MinIO, Supabase Storage, AWS S3,
 * Cloudflare R2) for anything shared. Keys look like engagements/<engagementId>/documents/<versionId>.
 */
export interface StoredFile {
  bytes: Uint8Array;
  contentType: string;
}

export interface FileStorage {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  /** Null when the key does not exist. */
  get(key: string): Promise<StoredFile | null>;
  delete(key: string): Promise<void>;
}
