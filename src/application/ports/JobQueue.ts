/**
 * Background work. A use case enqueues a job id after the job is saved; the queue calls the handler it was
 * built with, a few at a time. Adapters: InProcessJobQueue (one api instance). Several instances would
 * use a database-backed queue that claims jobs with a conditional update; the use cases do not change.
 */
export interface JobQueue {
  enqueue(jobId: string): void;
  /** Resolves when nothing is queued or running (tests and graceful shutdown). */
  idle(): Promise<void>;
}
