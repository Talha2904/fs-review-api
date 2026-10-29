import { cleanUsername, isRole, passwordProblem, usernameProblem } from '@fs-review/shared';

import type { User } from '../../domain/identity/User.js';

export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export const cleanEmail = (email: unknown): string =>
  String(email ?? '')
    .trim()
    .toLowerCase();

export function emailProblem(email: string, users: User[], selfId: string | null = null): string {
  if (!email) return '';
  if (!EMAIL_RE.test(email)) return 'Enter a valid email address.';
  if (users.some((u) => u.id !== selfId && u.email && u.email.toLowerCase() === email))
    return 'Another account already uses that email address.';
  return '';
}

export interface NewUserInput {
  name?: unknown;
  username?: unknown;
  password?: unknown;
  role?: unknown;
  email?: unknown;
}

/** The first problem with a new account, or an empty string. Same checks and wording as the old server. */
export function newUserProblem(input: NewUserInput, users: User[]): string {
  const email = cleanEmail(input.email);
  const ep = emailProblem(email, users);
  if (ep) return ep;
  if (!String(input.name ?? '').trim()) return 'Enter the person’s name.';
  const up = usernameProblem(input.username);
  if (up) return up;
  if (users.some((u) => u.username === cleanUsername(input.username))) return 'That username is already taken.';
  const pp = passwordProblem(typeof input.password === 'string' ? input.password : '');
  if (pp) return pp;
  if (!isRole(input.role)) return 'Choose a role.';
  return '';
}
