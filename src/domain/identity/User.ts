import type { Role } from '@fs-review/shared';

/** A staff account. The password hash never leaves the identity use cases. */
export interface User {
  id: string;
  name: string;
  username: string;
  email: string;
  role: Role;
  active: boolean;
  passwordHash: string;
  passwordSalt: string;
  createdAt: string;
  lastSignInAt: string | null;
  passwordChangedAt: string | null;
}

/** What the api returns about a user. Never the hash or salt. */
export interface PublicUser {
  id: string;
  name: string;
  username: string;
  email: string;
  role: Role;
  active: boolean;
  createdAt: string;
  lastSignInAt: string | null;
}

export const publicUser = (u: User): PublicUser => ({
  id: u.id,
  name: u.name,
  username: u.username,
  email: u.email,
  role: u.role,
  active: u.active,
  createdAt: u.createdAt,
  lastSignInAt: u.lastSignInAt
});

/** Who is acting: taken from the session, never from the request body. */
export interface Actor {
  id: string;
  name: string;
  username: string;
  role: Role;
  active: boolean;
}

export const actorOf = (u: User): Actor => ({ id: u.id, name: u.name, username: u.username, role: u.role, active: u.active });

/** A system actor for scheduled work (the twice-daily exchange rate update). */
export const SYSTEM_ACTOR: Actor = { id: 'system', name: 'Automatic update', username: 'system', role: 'Administrator', active: true };
