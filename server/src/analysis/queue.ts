export class QueueFullError extends Error {
  constructor(capacity: number) {
    super(`The analysis queue is full (capacity ${capacity}).`);
    this.name = "QueueFullError";
  }
}

export interface WorkQueueOptions {
  /** Maximum jobs running at once. Keep low: free-tier providers are rate limited. */
  concurrency: number;
  /** Maximum jobs waiting (not counting running ones). */
  capacity: number;
  /** Called when the worker throws; the queue itself never stops because of a failed job. */
  onError?: (id: string, err: unknown) => void;
}

/**
 * Small in-process FIFO queue with bounded concurrency and capacity. Ids are de-duplicated:
 * an id that is already waiting or running is not queued twice. Nothing is persisted here;
 * durable state lives in the analysis table and is recovered at start-up.
 */
export class WorkQueue {
  private readonly waiting: string[] = [];
  private readonly known = new Set<string>(); // waiting + running
  private running = 0;
  private stopped = false;
  private idleWaiters: (() => void)[] = [];

  constructor(
    private readonly worker: (id: string) => Promise<void>,
    private readonly options: WorkQueueOptions,
  ) {
    if (options.concurrency < 1) throw new Error("concurrency must be at least 1");
  }

  get pending(): number {
    return this.waiting.length;
  }

  get active(): number {
    return this.running;
  }

  has(id: string): boolean {
    return this.known.has(id);
  }

  enqueue(id: string): "queued" | "duplicate" {
    if (this.stopped) throw new Error("The analysis queue has been stopped.");
    if (this.known.has(id)) return "duplicate";
    if (this.waiting.length >= this.options.capacity) throw new QueueFullError(this.options.capacity);
    this.known.add(id);
    this.waiting.push(id);
    this.pump();
    return "queued";
  }

  /** Resolves when nothing is waiting or running. */
  idle(): Promise<void> {
    if (this.isIdle()) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  /** Stop accepting and starting work, then wait for running jobs (bounded by `timeoutMs`). */
  async stop(timeoutMs = 5000): Promise<void> {
    this.stopped = true;
    this.waiting.length = 0;
    if (this.running === 0) {
      this.known.clear();
      this.notifyIdle();
      return;
    }
    await Promise.race([this.idle(), new Promise<void>((r) => setTimeout(r, timeoutMs).unref?.())]);
  }

  private isIdle(): boolean {
    return this.waiting.length === 0 && this.running === 0;
  }

  private notifyIdle(): void {
    if (!this.isIdle()) return;
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    for (const w of waiters) w();
  }

  private pump(): void {
    while (!this.stopped && this.running < this.options.concurrency && this.waiting.length > 0) {
      const id = this.waiting.shift()!;
      this.running++;
      void this.worker(id)
        .catch((err: unknown) => this.options.onError?.(id, err))
        .finally(() => {
          this.running--;
          this.known.delete(id);
          this.pump();
          this.notifyIdle();
        });
    }
  }
}
