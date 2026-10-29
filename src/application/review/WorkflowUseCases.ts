import { canTransitionWorkflow, type PermissionMatrix, type WorkflowState } from '@fs-review/shared';

import { validationFailed } from '../../domain/errors.js';
import type { Actor } from '../../domain/identity/User.js';
import { currentVersions, isCleared, REQUIRED_SLOTS, type Person } from '../../domain/review/Document.js';
import { isActiveJob, type AnalysisJobRepository } from '../ports/AnalysisJobRepository.js';
import type { Clock } from '../ports/Clock.js';
import type { DocumentRepository } from '../ports/DocumentRepository.js';
import type { EventBus } from '../ports/EventBus.js';
import { EMPTY_WORKFLOW, type Workflow, type WorkflowRepository } from '../ports/WorkflowRepository.js';

import type { ReviewAccess } from './access.js';

const who = (a: Actor): Person => ({ id: a.id, name: a.name, role: a.role });

/**
 * Mark Ready for Review (documents.attach): every required document attached and cleared.
 * Send Back to Preparer (analysis.run): unlocks the documents with a reason.
 * Marking ready again after a return is allowed; anything else is refused.
 */
export class SetWorkflowState {
  constructor(
    private readonly access: ReviewAccess,
    private readonly workflows: WorkflowRepository,
    private readonly documents: DocumentRepository,
    private readonly clock: Clock,
    private readonly events: EventBus,
    private readonly jobs: AnalysisJobRepository
  ) {}

  async execute(actor: Actor | null, matrix: PermissionMatrix, engagementId: string, state: WorkflowState, reason = ''): Promise<Workflow> {
    const perm = state === 'ready' ? 'documents.attach' : 'analysis.run';
    const by = await this.access.writer(actor, matrix, engagementId, [perm]);
    const wf = (await this.workflows.get(engagementId)) ?? EMPTY_WORKFLOW(engagementId);
    if (isActiveJob(await this.jobs.latest(engagementId)))
      throw validationFailed('An analysis of this fund is running. Wait for it to finish.');
    if (!canTransitionWorkflow(wf.state, state)) throw validationFailed(`The documents cannot go from ${wf.state} to ${state}.`);
    if (state === 'ready') {
      const all = await this.documents.listByEngagement(engagementId);
      const current = currentVersions(all);
      const missing = REQUIRED_SLOTS.filter((s) => !current[s]);
      if (missing.length) throw validationFailed('Attach every required document before marking them ready.');
      const unclear = REQUIRED_SLOTS.filter((s) => !isCleared(current[s]));
      if (unclear.length) throw validationFailed('Every document must be recognised or confirmed before marking them ready.');
    }
    if (state === 'returned' && !String(reason || '').trim()) throw validationFailed('Give the reason for sending the documents back.');
    const now = this.clock.nowIso();
    const entry = { state, by: who(by), at: now, reason: String(reason || '').trim() };
    const next: Workflow = { engagementId, ...entry, history: [...wf.history, entry] };
    await this.workflows.save(next);
    await this.events.publish({ topic: 'workflows', engagementId, at: now });
    return next;
  }
}
