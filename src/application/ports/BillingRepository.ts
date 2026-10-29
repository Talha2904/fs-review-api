import type { BillingState } from '@fs-review/shared';

/**
 * Billing as the shared reducer sees it: one state of settings, sign-off events, invoices and number
 * sequences, stored across several tables by the adapter.
 */
export interface BillingRepository {
  get(): Promise<BillingState>;
  /**
   * Reads the current state, applies `change` and saves what it returns, all in one transaction. When another
   * change lands first the whole step is run again on the newer state, so no action, payment or invoice
   * number is ever lost or reused. `change` must be pure (it may run more than once) and may throw to refuse.
   */
  update<T>(change: (state: BillingState) => { state: BillingState; result: T }, updatedBy: string, at: string): Promise<T>;
}
