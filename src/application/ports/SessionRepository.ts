export interface Session {
  id: string;
  /** SHA-256 of the cookie token; the token itself is never stored. */
  tokenHash: string;
  userId: string;
  ip: string | null;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
}

export interface SessionRepository {
  create(session: Session): Promise<void>;
  /** The session for this token hash if it exists, is not revoked and has not expired at `now`. */
  findActive(tokenHash: string, now: string): Promise<Session | null>;
  revoke(tokenHash: string, at: string): Promise<void>;
  revokeAllForUser(userId: string, at: string): Promise<void>;
  /** Ends every session of the user except the one with this token hash (the caller's own). */
  revokeOthersForUser(userId: string, keepTokenHash: string, at: string): Promise<void>;
  /** Housekeeping: delete sessions expired before `before`. Returns how many went. */
  deleteExpired(before: string): Promise<number>;
}
