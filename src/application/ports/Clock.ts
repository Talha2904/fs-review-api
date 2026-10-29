/** Source of the current time. Use cases take this instead of calling Date, so tests can fix the clock. */
export interface Clock {
  /** ISO 8601 UTC timestamp, e.g. 2026-10-28T09:15:00.000Z */
  nowIso(): string;
  now(): Date;
}
