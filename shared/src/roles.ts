// Roles and what each may do. Used by the web app to show or hide controls, and by the api to
// enforce the same rules on every request, which is what actually protects the data.

export const ROLES = ['Administrator', 'Partner', 'Manager', 'Reviewer', 'Preparer', 'Finance'] as const;
export type Role = (typeof ROLES)[number];

/** The roles the Administrator can grant permissions to. Administrators and Finance are fixed. */
export const STAFF_ROLES = ['Partner', 'Manager', 'Reviewer', 'Preparer'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const EDITABLE_PERMS = [
  { id: 'engagements.edit', label: 'Add and edit engagements', verb: 'sets up engagements' },
  { id: 'documents.attach', label: 'Attach documents', verb: 'attaches documents' },
  { id: 'analysis.run', label: 'Run the analysis and version pass', verb: 'runs the analysis' },
  { id: 'points.raise', label: 'Raise review points and assign them', verb: 'raises review points' },
  { id: 'points.respond', label: 'Respond to review points', verb: 'responds to review points' },
  { id: 'points.clear', label: 'Clear or reopen points they raised', verb: 'clears their own points', noPreparer: true },
  { id: 'points.clearAny', label: 'Clear or reopen any point', verb: 'clears any point', noPreparer: true },
  { id: 'review.signoff', label: 'Sign off the review, or unlock it', verb: 'signs off reviews', noPreparer: true },
  {
    id: 'review.partnerSignoff',
    label: 'Partner sign-off, where a client or fund requires it',
    verb: 'gives the partner sign-off',
    noPreparer: true
  }
] as const;

export type EditablePermission = (typeof EDITABLE_PERMS)[number]['id'];
export type FixedPermission = 'users.manage' | 'activity.read' | 'activity.write' | 'reviews.read' | 'billing.manage';
export type Permission = EditablePermission | FixedPermission;

/** Which staff roles hold each editable permission. */
export type PermissionMatrix = Record<EditablePermission, StaffRole[]>;

export const DEFAULT_MATRIX: PermissionMatrix = {
  'engagements.edit': ['Manager'],
  'documents.attach': ['Manager', 'Reviewer', 'Preparer'],
  'analysis.run': ['Manager', 'Reviewer'],
  'points.raise': ['Partner', 'Manager', 'Reviewer'],
  'points.respond': ['Preparer'],
  'points.clear': ['Manager', 'Reviewer'],
  'points.clearAny': ['Partner', 'Manager'],
  'review.signoff': ['Manager'],
  'review.partnerSignoff': ['Partner']
};

// Not editable: only Administrators manage users, permissions and check rules, and read the log.
// Finance works only in the billing module, never review content.
const FIXED: Record<FixedPermission, readonly Role[]> = {
  'users.manage': ['Administrator'],
  'activity.read': ['Administrator'],
  'activity.write': ROLES,
  // fund reviews: documents, points, threads, checklists, reports. Finance sees sign-off events and AI usage only.
  'reviews.read': ['Administrator', 'Partner', 'Manager', 'Reviewer', 'Preparer'],
  'billing.manage': ['Finance']
};

const isFixed = (p: string): p is FixedPermission => p in FIXED;
const editable = (p: string) => EDITABLE_PERMS.find((e) => e.id === p);

/** Keeps only known permissions and staff roles, in a stable order. A Preparer can never clear a point. */
export function normalizeMatrix(m: unknown): PermissionMatrix {
  const src: Record<string, unknown> = { ...((m as Record<string, unknown>) || {}) };
  // matrices saved before points.edit was split into raise/respond
  if (Array.isArray(src['points.edit']) && !Array.isArray(src['points.raise'])) src['points.raise'] = src['points.edit'];
  return Object.fromEntries(
    EDITABLE_PERMS.map((p) => {
      const noPreparer = 'noPreparer' in p && p.noPreparer === true;
      const raw = src[p.id];
      const roles: readonly string[] = Array.isArray(raw) ? (raw as string[]) : DEFAULT_MATRIX[p.id];
      return [p.id, STAFF_ROLES.filter((r) => roles.includes(r) && !(noPreparer && r === 'Preparer'))];
    })
  ) as PermissionMatrix;
}

export interface Actor {
  id: string;
  role: Role;
  active?: boolean;
}

export function can(user: Actor | null | undefined, permission: Permission | string, matrix: PermissionMatrix): boolean {
  if (!user || user.active === false) return false;
  if (isFixed(permission)) return FIXED[permission].includes(user.role);
  const e = editable(permission);
  if (!e) return false;
  if (user.role === 'Preparer' && 'noPreparer' in e && e.noPreparer) return false;
  if (user.role === 'Administrator') return true;
  return (matrix[e.id] || []).includes(user.role as StaffRole);
}

/** Clearing or reopening a point: the raiser if their role may clear their own, or anyone who may clear any. */
export const canClearPoint = (
  user: Actor | null | undefined,
  point: { raisedBy?: { id: string } | null } | null,
  matrix: PermissionMatrix
): boolean =>
  can(user, 'points.clearAny', matrix) || (can(user, 'points.clear', matrix) && !!point?.raisedBy && point.raisedBy.id === user?.id);

export function describeRole(role: Role, matrix: PermissionMatrix): string {
  if (role === 'Administrator') return 'Manages users, roles, permissions and the firm’s check rules.';
  if (role === 'Finance') return 'Invoices signed-off reviews, including AI usage, and records payments and recovery.';
  const verbs = EDITABLE_PERMS.filter((p) => matrix[p.id]?.includes(role as StaffRole)).map((p) => p.verb);
  if (!verbs.length) return 'Views engagements, the analysis and review points.';
  const list = verbs.length > 1 ? verbs.slice(0, -1).join(', ') + ' and ' + verbs[verbs.length - 1] : verbs[0]!;
  return list.charAt(0).toUpperCase() + list.slice(1) + '.';
}

export const isAdminArea = (user: { role: Role } | null | undefined): boolean => user?.role === 'Administrator';
export const isFinanceArea = (user: { role: Role } | null | undefined): boolean => user?.role === 'Finance';

export const MIN_PASSWORD = 8;
export const passwordProblem = (pw: string | null | undefined): string =>
  !pw || pw.length < MIN_PASSWORD ? `Use at least ${MIN_PASSWORD} characters.` : '';
export const cleanUsername = (u: unknown): string =>
  String(u ?? '')
    .trim()
    .toLowerCase();
export const usernameProblem = (u: unknown): string =>
  /^[a-z0-9._-]{3,40}$/.test(cleanUsername(u)) ? '' : 'Use 3 to 40 letters, numbers, dots, dashes or underscores.';
export const isRole = (r: unknown): r is Role => typeof r === 'string' && (ROLES as readonly string[]).includes(r);
