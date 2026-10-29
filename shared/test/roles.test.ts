import { describe, expect, it } from 'vitest';

import { can, canClearPoint, DEFAULT_MATRIX, describeRole, normalizeMatrix, passwordProblem, usernameProblem } from '../src/roles.js';

const m = normalizeMatrix(DEFAULT_MATRIX);
const u = (role: Parameters<typeof can>[0] extends infer A ? (A extends { role: infer R } ? R : never) : never, id = 'u1') => ({
  id,
  role,
  active: true
});

describe('permission matrix', () => {
  it('defaults match the README table', () => {
    expect(can(u('Manager'), 'engagements.edit', m)).toBe(true);
    expect(can(u('Reviewer'), 'engagements.edit', m)).toBe(false);
    expect(can(u('Preparer'), 'documents.attach', m)).toBe(true);
    expect(can(u('Preparer'), 'points.respond', m)).toBe(true);
    expect(can(u('Reviewer'), 'points.respond', m)).toBe(false);
    expect(can(u('Partner'), 'review.partnerSignoff', m)).toBe(true);
    expect(can(u('Manager'), 'review.signoff', m)).toBe(true);
  });

  it('administrators hold every editable permission and the fixed admin ones', () => {
    expect(can(u('Administrator'), 'users.manage', m)).toBe(true);
    expect(can(u('Administrator'), 'activity.read', m)).toBe(true);
    expect(can(u('Administrator'), 'review.signoff', m)).toBe(true);
    expect(can(u('Administrator'), 'billing.manage', m)).toBe(false);
    expect(can(u('Finance'), 'billing.manage', m)).toBe(true);
  });

  it('a Preparer can never clear, sign off or partner-sign, even if the matrix says so', () => {
    const granted = normalizeMatrix({ ...DEFAULT_MATRIX, 'points.clear': ['Preparer', 'Manager'], 'review.signoff': ['Preparer'] });
    expect(granted['points.clear']).toEqual(['Manager']);
    expect(granted['review.signoff']).toEqual([]);
    expect(can(u('Preparer'), 'points.clear', granted)).toBe(false);
  });

  it('inactive users and unknown permissions get nothing', () => {
    expect(can({ id: 'x', role: 'Administrator', active: false }, 'users.manage', m)).toBe(false);
    expect(can(u('Manager'), 'made.up', m)).toBe(false);
    expect(can(null, 'activity.write', m)).toBe(false);
  });

  it('normalizes legacy points.edit and drops unknown roles', () => {
    const n = normalizeMatrix({ 'points.edit': ['Reviewer', 'Janitor'] });
    expect(n['points.raise']).toEqual(['Reviewer']);
    expect(n['documents.attach']).toEqual(DEFAULT_MATRIX['documents.attach']);
  });

  it('clearing a point: the raiser with points.clear, or anyone with points.clearAny', () => {
    const point = { raisedBy: { id: 'r1' } };
    expect(canClearPoint(u('Reviewer', 'r1'), point, m)).toBe(true);
    expect(canClearPoint(u('Reviewer', 'r2'), point, m)).toBe(false);
    expect(canClearPoint(u('Manager', 'm1'), point, m)).toBe(true);
  });

  it('describes roles from the matrix', () => {
    expect(describeRole('Preparer', m)).toBe('Attaches documents and responds to review points.');
    expect(describeRole('Finance', m)).toMatch(/Invoices/);
  });
});

describe('credentials', () => {
  it('validates passwords and usernames', () => {
    expect(passwordProblem('short')).toMatch(/at least 8/);
    expect(passwordProblem('longenough')).toBe('');
    expect(usernameProblem('Ali.Awan')).toBe('');
    expect(usernameProblem('a b')).toMatch(/3 to 40/);
  });
});
