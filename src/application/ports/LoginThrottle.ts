/**
 * Counts sign-in attempts per key within a fifteen-minute window: per address and username (five), and per
 * username from any address (twenty). Backed by a table so the limit holds across restarts and instances;
 * the count is incremented atomically, so parallel attempts cannot share one reading of it.
 */
export interface LoginThrottle {
  /** Records one attempt and returns how many there have been in the current window. */
  hit(key: string, now: string): Promise<{ count: number }>;
  /** Clears the counter after a successful sign-in. */
  clear(key: string): Promise<void>;
}

export const LOGIN_MAX_ATTEMPTS = 5;
export const LOGIN_MAX_PER_USERNAME = 20;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
