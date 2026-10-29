import { applyBilling, BillingRuleError, type AiUsage, type BillingAction, type BillingResult, type BillingState } from '@fs-review/shared';

import { validationFailed } from '../../domain/errors.js';
import type { Actor } from '../../domain/identity/User.js';
import type { ActivityRecorder } from '../activity/ActivityRecorder.js';
import type { ActivityLog } from '../ports/ActivityLog.js';
import type { BillingRepository } from '../ports/BillingRepository.js';
import type { Clock } from '../ports/Clock.js';
import type { IdGenerator } from '../ports/IdGenerator.js';

/**
 * Applies one billing action through the shared reducer, saves the result and logs it.
 * Used by every billing use case, including email, exchange rate and Xero, so the rules live in one place.
 */
export class BillingActions {
  constructor(
    private readonly billing: BillingRepository,
    private readonly log: ActivityLog,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly activity: ActivityRecorder
  ) {}

  /** AI usage as billing sees it: every logged Claude call that belongs to a fund. */
  async usage(): Promise<AiUsage[]> {
    return (await this.log.usage()).map((u) => ({
      id: u.id,
      at: u.at,
      engagementId: u.engagementId,
      fundName: u.fundName,
      model: u.model,
      input: u.input,
      output: u.output,
      step: u.step
    }));
  }

  async state(): Promise<{ state: BillingState; usage: AiUsage[] }> {
    return { state: await this.billing.get(), usage: await this.usage() };
  }

  async apply(actor: Actor, action: BillingAction, ip?: string): Promise<BillingResult & { usage: AiUsage[] }> {
    const usage = await this.usage();
    const now = this.clock.nowIso();
    let r: BillingResult;
    try {
      // read, reduce and save in one transaction; re-run on the newer state if another action landed first
      r = await this.billing.update(
        (state) => {
          const out = applyBilling(state, action, { user: { id: actor.id, name: actor.name }, usage, now, uid: () => this.ids.next() });
          return { state: out.state, result: out };
        },
        actor.id,
        now
      );
    } catch (e) {
      if (e instanceof BillingRuleError) throw validationFailed(e.message);
      throw e;
    }
    const ctx: { engagementId?: string; fundName?: string } = r.invoice ?? r.engagement ?? {};
    await this.activity.record({
      actor,
      category: 'Billing',
      summary: r.log,
      details: r.details || '',
      ip: ip ?? '',
      engagementId: ctx.engagementId ?? null,
      fundName: ctx.fundName ?? null
    });
    return { ...r, usage };
  }
}
