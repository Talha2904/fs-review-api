import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

import type { FileStorage, StoredFile } from '../../application/ports/FileStorage.js';

export interface S3Config {
  endpoint?: string | undefined;
  region: string;
  bucket: string;
  accessKey?: string | undefined;
  secretKey?: string | undefined;
  forcePathStyle: boolean;
}

/** Any S3-compatible store: MinIO locally, Supabase Storage's S3 endpoint, AWS S3 or Cloudflare R2 in production. */
export class S3Storage implements FileStorage {
  private readonly client: S3Client;

  constructor(private readonly cfg: S3Config) {
    this.client = new S3Client({
      region: cfg.region,
      ...(cfg.endpoint ? { endpoint: cfg.endpoint } : {}),
      forcePathStyle: cfg.forcePathStyle,
      ...(cfg.accessKey && cfg.secretKey ? { credentials: { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey } } : {})
    });
  }

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: this.cfg.bucket, Key: key, Body: bytes, ContentType: contentType }));
  }

  async get(key: string): Promise<StoredFile | null> {
    try {
      const r = await this.client.send(new GetObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
      const bytes = r.Body ? await r.Body.transformToByteArray() : new Uint8Array();
      return { bytes, contentType: r.ContentType || 'application/octet-stream' };
    } catch (e) {
      const name = (e as { name?: string })?.name;
      if (name === 'NoSuchKey' || name === 'NotFound') return null;
      throw e;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
  }
}
