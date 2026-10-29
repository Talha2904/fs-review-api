export interface PasswordReset {
  id: string;
  /** SHA-256 of the link's secret; the secret itself is never stored. */
  tokenHash: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
}

export interface PasswordResetRepository {
  /** Replaces any outstanding reset for the user with this one. */
  create(reset: PasswordReset): Promise<void>;
  findByTokenHash(tokenHash: string): Promise<PasswordReset | null>;
  /** Marks the link used if nobody has used it yet; false when it was already used (a link works once). */
  markUsed(id: string, at: string): Promise<boolean>;
  /** Removes the user's unused links (after their email, password or access changes). */
  deleteUnusedForUser(userId: string): Promise<void>;
}
