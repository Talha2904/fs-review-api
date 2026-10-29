import type { PermissionMatrix } from '@fs-review/shared';

import { validationFailed } from '../../domain/errors.js';
import type { Actor } from '../../domain/identity/User.js';
import { currentVersions, type Person } from '../../domain/review/Document.js';
import { typeFor, type PointContent, type PointMessage, type ReviewPoint } from '../../domain/review/Point.js';
import type { AnalysisRun, AnalysisRunRepository } from '../ports/AnalysisRunRepository.js';
import type { Clock } from '../ports/Clock.js';
import type { DocumentRepository } from '../ports/DocumentRepository.js';
import type { EventBus } from '../ports/EventBus.js';
import type { IdGenerator } from '../ports/IdGenerator.js';
import type { PointMessageRepository, PointRepository } from '../ports/PointRepository.js';
import type { WorkflowRepository } from '../ports/WorkflowRepository.js';
import type { ReviewAccess } from '../review/access.js';

const who = (a: Actor): Person => ({ id: a.id, name: a.name, role: a.role });

/**
 * Keeps one analysis with the document versions it read. Called by the analysis job (RunAnalysisJob)
 * once the analysis has run on the api; the documents must still be marked ready.
 */
export class SaveAnalysisRun {
  constructor(
    private readonly access: ReviewAccess,
    private readonly runs: AnalysisRunRepository,
    private readonly documents: DocumentRepository,
    private readonly workflows: WorkflowRepository,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly events: EventBus
  ) {}

  async execute(
    actor: Actor | null,
    matrix: PermissionMatrix,
    engagementId: string,
    input: { result: Record<string, unknown>; analysedAt: string; settingsSig: string; documentVersions?: Record<string, string> }
  ): Promise<AnalysisRun> {
    const by = await this.access.writer(actor, matrix, engagementId, ['analysis.run']);
    const wf = await this.workflows.get(engagementId);
    if (wf?.state !== 'ready') throw validationFailed('The documents must be marked ready for review before an analysis is recorded.');
    if (!input.result || typeof input.result !== 'object') throw validationFailed('The analysis result is missing.');
    // the versions the analysis read (the job passes them); otherwise the current ones
    const current: Record<string, string> =
      input.documentVersions ??
      Object.fromEntries(
        Object.entries(currentVersions(await this.documents.listByEngagement(engagementId))).map(([slot, v]) => [slot, v!.id])
      );
    const now = this.clock.nowIso();
    const run: AnalysisRun = {
      id: this.ids.next(),
      engagementId,
      version: Number(input.result.version) || 1,
      result: input.result,
      analysedAt: input.analysedAt || now,
      settingsSig: String(input.settingsSig || ''),
      documentVersions: current,
      by: who(by),
      at: now
    };
    await this.runs.create(run);
    await this.events.publish({ topic: 'analysis_runs', engagementId, at: now });
    return run;
  }
}

export interface AnalysisPointInput extends PointContent {
  ref: string;
  status?: string;
}

/**
 * Saves the analysis's points (called by the analysis job): new references become open points assigned to the preparer; points
 * already saved keep their status and thread, take the latest wording, and get a note on the re-test.
 */
export class SyncAnalysisPoints {
  constructor(
    private readonly access: ReviewAccess,
    private readonly points: PointRepository,
    private readonly messages: PointMessageRepository,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly events: EventBus
  ) {}

  async execute(
    actor: Actor | null,
    matrix: PermissionMatrix,
    engagementId: string,
    list: AnalysisPointInput[],
    assignee: Person | null,
    draft: number
  ): Promise<{ created: number }> {
    const by = await this.access.writer(actor, matrix, engagementId, ['analysis.run']);
    if (!Array.isArray(list)) throw validationFailed('The points are missing.');
    const existing = await this.points.listByEngagement(engagementId);
    const now = this.clock.nowIso();
    let created = 0;
    const msg = async (p: ReviewPoint, kind: PointMessage['kind'], author: Person | null, text: string) =>
      this.messages.create({
        id: this.ids.next(),
        pointId: p.id,
        engagementId,
        kind,
        author,
        at: this.clock.nowIso(),
        text,
        attachments: []
      });
    for (const raw of list) {
      if (!raw || typeof raw.ref !== 'string' || !raw.ref) continue;
      const { status: _status, ...content } = raw;
      const found = existing.find((x) => x.ref === raw.ref);
      if (!found) {
        const rec: ReviewPoint = {
          id: this.ids.next(),
          engagementId,
          ref: raw.ref,
          source: 'analysis',
          content,
          status: 'open',
          type: typeFor(content),
          dueDate: null,
          assignedTo: assignee,
          raisedBy: who(by),
          raisedAt: now,
          clearedBy: null,
          clearedAt: null,
          updatedAt: now
        };
        await this.points.create(rec);
        created++;
        await msg(rec, 'raise', who(by), `Raised by the analysis of draft v${draft}.`);
        if (assignee) await msg(rec, 'assign', who(by), `Assigned to ${assignee.name}.`);
      } else {
        await this.points.update({ ...found, content: { ...found.content, ...content }, updatedAt: now }, found.updatedAt);
        if (found.status !== 'cleared' && content.agent === 'resolved')
          await msg(
            found,
            'note',
            null,
            `Re-tested on draft v${draft}: appears resolved. ${content.agentNote || ''} Clear it if you agree.`.trim()
          );
        else if (found.status !== 'cleared' && content.agent === 'outstanding')
          await msg(found, 'note', null, `Re-tested on draft v${draft}: still outstanding. ${content.agentNote || ''}`.trim());
      }
    }
    await this.events.publish({ topic: 'review_points', engagementId, at: now });
    return { created };
  }
}
