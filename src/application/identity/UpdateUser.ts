import { describeUserChange, isRole, passwordProblem, type PermissionMatrix } from '@fs-review/shared';

import { notFound, validationFailed } from '../../domain/errors.js';
import { publicUser, type Actor, type PublicUser, type User } from '../../domain/identity/User.js';
import type { ActivityRecorder } from '../activity/ActivityRecorder.js';
import type { Clock } from '../ports/Clock.js';
import type { PasswordHasher } from '../ports/PasswordHasher.js';
import type { PasswordResetRepository } from '../ports/PasswordResetRepository.js';
import type { SessionRepository } from '../ports/SessionRepository.js';
import type { Tokens } from '../ports/Tokens.js';
import type { UserRepository } from '../ports/UserRepository.js';

import { requirePermission } from './authorize.js';
import { cleanEmail, emailProblem } from './userValidation.js';

export interface UserPatch {
  name?: string;
  role?: string;
  active?: boolean;
  email?: string;
  password?: string;
}

/** Rename, change role, deactivate or reactivate, set an email, or reset a password. Accounts are never deleted. */
export class UpdateUser {
  constructor(
    private readonly users: UserRepository,
    private readonly sessions: SessionRepository,
    private readonly hasher: PasswordHasher,
    private readonly clock: Clock,
    private readonly activity: ActivityRecorder,
    private readonly resets: PasswordResetRepository,
    private readonly tokens: Tokens
  ) {}

  async execute(
    actor: Actor | null,
    matrix: PermissionMatrix,
    id: string,
    patch: UserPatch,
    ip?: string,
    sessionToken?: string
  ): Promise<PublicUser> {
    const by = requirePermission(actor, 'users.manage', matrix);
    const all = await this.users.list();
    const u = all.find((x) => x.id === id);
    if (!u) throw notFound('That user');
    const next: User = { ...u };
    if (patch.name !== undefined) {
      if (!String(patch.name).trim()) throw validationFailed('Enter the person’s name.');
      next.name = String(patch.name).trim();
    }
    if (patch.role !== undefined) {
      if (!isRole(patch.role)) throw validationFailed('Choose a role.');
      next.role = patch.role;
    }
    if (patch.active !== undefined) next.active = !!patch.active;
    if (patch.email !== undefined) {
      const email = cleanEmail(patch.email);
      const p = emailProblem(email, all, u.id);
      if (p) throw validationFailed(p);
      next.email = email;
    }
    if (patch.password !== undefined) {
      const p = passwordProblem(patch.password);
      if (p) throw validationFailed(p);
      const { hash, salt } = await this.hasher.hash(patch.password);
      next.passwordHash = hash;
      next.passwordSalt = salt;
      next.passwordChangedAt = this.clock.nowIso();
    }
    const admins =
      all.filter((x) => x.id !== u.id && x.active && x.role === 'Administrator').length +
      (next.active && next.role === 'Administrator' ? 1 : 0);
    if (!admins) throw validationFailed('Keep at least one active Administrator.');
    await this.users.update(next);
    for (const summary of describeUserChange(u, next, patch.password !== undefined))
      await this.activity.record({ actor: by, category: 'Users', summary, ip: ip ?? '' });
    // A deactivated, re-passworded or re-roled person signs in again; the Administrator's own session is kept.
    const now = this.clock.nowIso();
    if ((!next.active || patch.password !== undefined || next.role !== u.role) && u.id !== by.id)
      await this.sessions.revokeAllForUser(u.id, now);
    // changing your own password ends your other sign-ins, keeping this one
    if (patch.password !== undefined && u.id === by.id && sessionToken)
      await this.sessions.revokeOthersForUser(u.id, this.tokens.fingerprint(sessionToken), now);
    // an emailed reset link must not outlive a change of email, password or access
    if (!next.active || patch.password !== undefined || next.email !== u.email) await this.resets.deleteUnusedForUser(u.id);
    return publicUser(next);
  }
}
