// Who may change a fund's review. Applied in one place and used by every review use case.
// Reads are open to every signed-in staff member (the listing and portfolio show every fund);
// writes need the matching permission under the saved matrix, and nothing changes once the review
// is locked by a sign-off.
import { isLockedSignoff, type Permission, type PermissionMatrix } from '@fs-review/shared';

import { locked, notFound, validationFailed } from '../../domain/errors.js';
import type { Actor } from '../../domain/identity/User.js';
import type { DocumentVersion } from '../../domain/review/Document.js';
import { requireAnyPermission, requirePermission } from '../identity/authorize.js';
import type { EngagementRepository } from '../ports/EngagementRepository.js';
import type { SignoffRepository } from '../ports/SignoffRepository.js';
import type { WorkflowRepository } from '../ports/WorkflowRepository.js';

export class ReviewAccess {
  constructor(
    private readonly engagements: EngagementRepository,
    private readonly signoffs: SignoffRepository,
    private readonly workflows: WorkflowRepository
  ) {}

  /**
   * A change to the documents themselves: as `writer`, and the documents must not be marked ready
   * for review, unless the caller says the change is a revised document on a point response.
   */
  async documentWriter(
    actor: Actor | null,
    matrix: PermissionMatrix,
    engagementId: string,
    permissions: Permission[],
    opts: { whileReady?: boolean } = {}
  ): Promise<Actor> {
    const by = await this.writer(actor, matrix, engagementId, permissions);
    const wf = await this.workflows.get(engagementId);
    if (wf?.state === 'ready' && !opts.whileReady)
      throw validationFailed('The documents are marked ready for review. Send them back to the preparer to change them.');
    return by;
  }

  /**
   * A change to one attached version (its check, confirmation or reading): as `writer`, not on a removed
   * version, and while the documents are marked ready only on a version attached after that (a revised
   * document on a point response, which still has to be checked).
   */
  async versionWriter(actor: Actor | null, matrix: PermissionMatrix, v: DocumentVersion, permissions: Permission[]): Promise<Actor> {
    const by = await this.writer(actor, matrix, v.engagementId, permissions);
    if (v.removedAt) throw validationFailed('That version was removed.');
    const wf = await this.workflows.get(v.engagementId);
    if (wf?.state === 'ready' && wf.at && v.uploadedAt <= wf.at)
      throw validationFailed('The documents are marked ready for review. Send them back to the preparer to change them.');
    return by;
  }

  /** The engagement must exist; any member of the review staff may read it (not Finance, plan section 6.6). */
  async reader(actor: Actor | null, matrix: PermissionMatrix, engagementId: string): Promise<Actor> {
    const by = requirePermission(actor, 'reviews.read', matrix);
    if (!(await this.engagements.findById(engagementId))) throw notFound('That engagement');
    return by;
  }

  /** A write: one of the permissions, an existing engagement, and no sign-off lock. */
  async writer(
    actor: Actor | null,
    matrix: PermissionMatrix,
    engagementId: string,
    permissions: Permission[],
    message?: string
  ): Promise<Actor> {
    const by =
      permissions.length === 1
        ? requirePermission(actor, permissions[0]!, matrix)
        : requireAnyPermission(actor, permissions, matrix, message);
    if (!(await this.engagements.findById(engagementId))) throw notFound('That engagement');
    const s = await this.signoffs.get(engagementId);
    if (s && isLockedSignoff(s.state)) throw locked();
    return by;
  }
}
