// JobQueue for a single api instance: jobs run in this process, `concurrency` at a time, in the order
// they were queued. The job's state lives in the database, so a restart loses nothing but the run in
// progress (RecoverAnalysisJobs marks it failed and re-queues the waiting ones).
import type { JobQueue } from '../../application/ports/JobQueue.js';
import type { Logger } from '../../application/ports/Logger.js';

export class InProcessJobQueue implements JobQueue {
  private readonly waiting: string[] = [];
  private running = 0;
  private handler: ((jobId: string) => Promise<void>) | null = null;
  private idlers: (() => void)[] = [];

  constructor(
    private readonly concurrency: number,
    private readonly logger: Logger
  ) {}

  /** The work to do for each job. Set once by the composition root, after the use case is built. */
  handle(handler: (jobId: string) => Promise<void>): void {
    this.handler = handler;
    this.pump();
  }

  enqueue(jobId: string): void {
    this.waiting.push(jobId);
    // after the current request has answered
    setImmediate(() => this.pump());
  }

  idle(): Promise<void> {
    if (!this.running && !this.waiting.length) return Promise.resolve();
    return new Promise((resolve) => this.idlers.push(resolve));
  }

  private pump(): void {
    if (!this.handler) return;
    while (this.running < Math.max(1, this.concurrency) && this.waiting.length) {
      const id = this.waiting.shift() as string;
      this.running++;
      this.handler(id)
        .catch((e: unknown) => this.logger.error({ err: e, jobId: id }, 'Background job failed'))
        .finally(() => {
          this.running--;
          this.pump();
          if (!this.running && !this.waiting.length) {
            const done = this.idlers;
            this.idlers = [];
            done.forEach((r) => r());
          }
        });
    }
  }
}
