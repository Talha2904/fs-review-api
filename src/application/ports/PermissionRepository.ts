import type { PermissionMatrix } from '@fs-review/shared';

/** The editable permission matrix. Read on every request, so a change applies to everyone's next action. */
export interface PermissionRepository {
  get(): Promise<PermissionMatrix>;
  save(matrix: PermissionMatrix, updatedBy: string, at: string): Promise<void>;
}
