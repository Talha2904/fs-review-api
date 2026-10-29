import type { ReviewLike } from '@fs-review/shared';

/**
 * What the bell's rule (notificationsFor in @fs-review/shared) reads about every fund, loaded lean for one person
 * (Phase 7 load test): every point's status and people with its title, not its whole content; and only the
 * messages on points that person raised or is assigned, from `messagesSince` on, since only those become updates.
 * The rest of each fund's review (checklists, reports, analysis results) is not read.
 */
export interface BellReadModel {
  reviews(userId: string, messagesSince: string): Promise<Record<string, ReviewLike>>;
}
