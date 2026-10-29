import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { FileStorage, StoredFile } from '../../application/ports/FileStorage.js';

/**
 * Files on the api's own disk, for development and single-machine installs. Keys are validated so a
 * key can never escape the root. The content type is kept in a sidecar file.
 */
export class LocalDiskStorage implements FileStorage {
  constructor(private readonly root: string) {}

  private pathFor(key: string): string {
    if (!/^[A-Za-z0-9._/-]+$/.test(key) || key.includes('..')) throw new Error('Invalid storage key');
    return path.join(this.root, ...key.split('/'));
  }

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    const file = this.pathFor(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, bytes);
    await writeFile(file + '.type', contentType, 'utf8');
  }

  async get(key: string): Promise<StoredFile | null> {
    const file = this.pathFor(key);
    try {
      const [bytes, contentType] = await Promise.all([
        readFile(file),
        readFile(file + '.type', 'utf8').catch(() => 'application/octet-stream')
      ]);
      return { bytes: new Uint8Array(bytes), contentType };
    } catch (e) {
      if ((e as { code?: string }).code === 'ENOENT') return null;
      throw e;
    }
  }

  async delete(key: string): Promise<void> {
    const file = this.pathFor(key);
    await rm(file, { force: true });
    await rm(file + '.type', { force: true });
  }
}
