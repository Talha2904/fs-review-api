import { describe, expect, it } from 'vitest';

import { canTransitionWorkflow, isLockedSignoff, nextPointStatus } from '../src/workflow.js';

describe('workflow state machine', () => {
  it('allows preparing → ready → returned → ready and nothing else', () => {
    expect(canTransitionWorkflow('preparing', 'ready')).toBe(true);
    expect(canTransitionWorkflow('ready', 'returned')).toBe(true);
    expect(canTransitionWorkflow('returned', 'ready')).toBe(true);
    expect(canTransitionWorkflow('preparing', 'returned')).toBe(false);
    expect(canTransitionWorkflow('ready', 'preparing')).toBe(false);
  });

  it('locks the review from the manager sign-off until unlock', () => {
    expect(isLockedSignoff('manager-signed')).toBe(true);
    expect(isLockedSignoff('signed')).toBe(true);
    expect(isLockedSignoff('returned')).toBe(false);
    expect(isLockedSignoff('resubmitted')).toBe(false);
    expect(isLockedSignoff('unlocked')).toBe(false);
    expect(isLockedSignoff('none')).toBe(false);
  });

  it('moves points through open → responded → cleared, with reopen', () => {
    expect(nextPointStatus('open', 'response')).toBe('responded');
    expect(nextPointStatus('responded', 'clear')).toBe('cleared');
    expect(nextPointStatus('cleared', 'reopen')).toBe('reopened');
    expect(nextPointStatus('reopened', 'response')).toBe('responded');
    expect(nextPointStatus('open', 'reopen')).toBeNull();
    expect(nextPointStatus('cleared', 'clear')).toBeNull();
  });
});
