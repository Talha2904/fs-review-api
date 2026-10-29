import { DEFAULT_MATRIX, normalizeMatrix, type PermissionMatrix } from '@fs-review/shared';

import type { PermissionRepository } from '../../../application/ports/PermissionRepository.js';
import type { Db } from '../prisma.js';

const ROW_ID = 1;

export class PrismaPermissionRepository implements PermissionRepository {
  constructor(private readonly db: Db) {}

  async get(): Promise<PermissionMatrix> {
    const r = await this.db.permissionMatrix.findUnique({ where: { id: ROW_ID } });
    return normalizeMatrix(r ? r.matrix : DEFAULT_MATRIX);
  }

  async save(matrix: PermissionMatrix, updatedBy: string, at: string): Promise<void> {
    const clean = normalizeMatrix(matrix);
    await this.db.permissionMatrix.upsert({
      where: { id: ROW_ID },
      create: { id: ROW_ID, matrix: clean, updatedBy, updatedAt: new Date(at) },
      update: { matrix: clean, updatedBy, updatedAt: new Date(at) }
    });
  }
}
