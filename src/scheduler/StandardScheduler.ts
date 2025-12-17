import type { Job } from '../core/Job';
import type { IQueue } from '../strategies/queue/IQueue';
import type { IAsyncThrottler, ThrottlePermit } from '../strategies/throttle/IAsyncThrottler';
import type { IThrottler } from '../strategies/throttle/IThrottler';
import type { IScheduler } from './IScheduler';

export interface StandardSchedulerOptions {
  /** Maximum concurrent jobs (default: 1) */
  concurrency?: number;
  /** Whether to start processing immediately (default: false) */
  autoStart?: boolean;
  /** Async throttlers (e.g. Redis-backed distributed rate limiting) */
  asyncThrottlers?: IAsyncThrottler[];
}

/**
 * Standard job scheduler that coordinates job execution.
 * Respects concurrency limits and throttling rules.
 */
export class StandardScheduler implements IScheduler {
  private _concurrency: number;
  private _isPaused: boolean;
  private _runningCount = 0;
  private scheduledTimer: ReturnType<typeof setTimeout> | null = null;
  private idleCallbacks: Set<() => void> = new Set();
  private activeCallbacks: Set<() => void> = new Set();
  private wasActive = false;
  private readonly asyncThrottlers: IAsyncThrottler[];
  private asyncRateLimitedUntil = 0;
  private processing = false;
  private tryNextRequested = false;
  private generation = 0;

  constructor(
    private readonly queue: IQueue<Job<unknown>>,
    private readonly throttlers: IThrottler[],
    options: StandardSchedulerOptions = {},
  ) {
    this._concurrency = options.concurrency ?? 1;
    this._isPaused = !(options.autoStart ?? false);
    this.asyncThrottlers = options.asyncThrottlers ?? [];
  }

  get concurrency(): number {
    return this._concurrency;
  }

  set concurrency(value: number) {
    this._concurrency = value;
    this.tryNext();
  }

  /**
   * Number of jobs currently waiting in the queue.
   *
   * @returns The pending job count
   */
  get pendingCount(): number {
    return this.queue.size;
  }

  /**
   * Number of jobs currently running.
   *
   * @returns The running job count
   */
  get runningCount(): number {
    return this._runningCount;
  }

  /**
   * Whether the scheduler is paused.
   *
   * @returns True if paused, false otherwise
   */
  get isPaused(): boolean {
    return this._isPaused;
  }

  /**
   * Whether the scheduler is currently rate limited by any throttler.
   */
  get isRateLimited(): boolean {
    return this.getMaxThrottleDelay() > 0 || this.asyncRateLimitedUntil > Date.now();
  }

  /**
   * Whether the scheduler is saturated (at concurrency limit OR rate limited).
   */
  get isSaturated(): boolean {
    return this._runningCount >= this._concurrency || this.isRateLimited;
  }

  /**
   * Adds a job to the scheduler's queue.
   *
   * @param job - The job to add
   */
  add(job: Job<unknown>): void {
    const wasEmpty = this.queue.size === 0 && this._runningCount === 0;
    this.queue.enqueue(job);

    if (wasEmpty && !this._isPaused) {
      this.emitActive();
    }

    this.tryNext();
  }

  /**
   * Starts processing jobs from the queue.
   */
  start(): void {
    this._isPaused = false;
    this.tryNext();
  }

  /**
   * Pauses job processing. Running jobs will continue to completion.
   */
  pause(): void {
    this._isPaused = true;
    if (this.scheduledTimer) {
      clearTimeout(this.scheduledTimer);
      this.scheduledTimer = null;
    }
  }

  /**
   * Attempts to start the next job if conditions allow.
   * Respects concurrency limits and throttling rules.
   */
  tryNext(): void {
    if (this._isPaused) {
      return;
    }

    if (this.scheduledTimer) {
      clearTimeout(this.scheduledTimer);
      this.scheduledTimer = null;
    }

    if (this.asyncThrottlers.length === 0) {
      while (this._runningCount < this._concurrency && this.queue.size > 0) {
        const maxDelay = this.getMaxThrottleDelay();

        if (maxDelay > 0) {
          this.scheduledTimer = setTimeout(() => {
            this.scheduledTimer = null;
            this.tryNext();
          }, maxDelay);
          return;
        }

        const job = this.queue.dequeue();
        if (!job) {
          break;
        }

        if (job.status === 'cancelled') {
          continue;
        }

        this.runJob(job);
      }

      return;
    }

    this.requestProcessLoop();
  }

  /**
   * Removes all pending jobs from the queue.
   * Running jobs will continue to completion.
   */
  clear(): void {
    this.generation++;
    this.asyncRateLimitedUntil = 0;
    if (this.scheduledTimer) {
      clearTimeout(this.scheduledTimer);
      this.scheduledTimer = null;
    }

    while (this.queue.size > 0) {
      const job = this.queue.dequeue();
      job?.cancel();
    }

    this.queue.clear();

    if (this._runningCount === 0) {
      this.emitIdle();
    }
  }

  /**
   * Explicitly reset async throttler state (best-effort).
   * This does not affect the pending queue; it only clears async rate-limit timers and calls `reset()`
   * on async throttlers that implement it.
   */
  async resetAsyncThrottlers(): Promise<void> {
    this.generation++;
    this.asyncRateLimitedUntil = 0;

    if (this.scheduledTimer) {
      clearTimeout(this.scheduledTimer);
      this.scheduledTimer = null;
    }

    const resetCalls = this.asyncThrottlers
      .map((throttler) => throttler.reset?.())
      .filter((promise): promise is Promise<void> => Boolean(promise));

    if (resetCalls.length > 0) {
      const results = await Promise.allSettled(resetCalls);
      const errors = results
        .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
        .map((result) => result.reason);
      if (errors.length > 0) {
        throw new AggregateError(errors, 'StandardScheduler.resetAsyncThrottlers failed');
      }
    }

    this.tryNext();
  }

  /**
   * Registers a callback to be invoked when the queue becomes idle.
   *
   * @param callback - Function to call when idle
   * @returns Unsubscribe function
   */
  onIdle(callback: () => void): () => void {
    this.idleCallbacks.add(callback);
    return () => {
      this.idleCallbacks.delete(callback);
    };
  }

  /**
   * Registers a callback to be invoked when the queue becomes active.
   *
   * @param callback - Function to call when active
   * @returns Unsubscribe function
   */
  onActive(callback: () => void): () => void {
    this.activeCallbacks.add(callback);
    return () => {
      this.activeCallbacks.delete(callback);
    };
  }

  /**
   * Gets the maximum delay required by all synchronous throttlers.
   *
   * @returns Maximum delay in milliseconds
   */
  private getMaxThrottleDelay(): number {
    let maxDelay = 0;
    for (const throttler of this.throttlers) {
      const delay = throttler.getNextRunDelay();
      if (delay > maxDelay) {
        maxDelay = delay;
      }
    }
    return maxDelay;
  }

  /**
   * Requests the asynchronous processing loop to start if not already running.
   * Handles re-entry by setting a flag to restart after current loop completes.
   */
  private requestProcessLoop(): void {
    this.tryNextRequested = true;
    if (this.processing) {
      return;
    }
    this.processing = true;
    void this.processLoop().finally(() => {
      this.processing = false;
      if (this.tryNextRequested) {
        this.tryNextRequested = false;
        this.tryNext();
      }
    });
  }

  /**
   * Main asynchronous processing loop for handling async throttlers.
   * Continues processing jobs until paused, cleared, or no jobs remain.
   */
  private async processLoop(): Promise<void> {
    this.tryNextRequested = false;
    const generationAtStart = this.generation;

    while (
      !this._isPaused &&
      generationAtStart === this.generation &&
      this._runningCount < this._concurrency &&
      this.queue.size > 0
    ) {
      const peeked = this.queue.peek();
      if (!peeked) {
        break;
      }

      if (this.isJobCancelled(peeked)) {
        this.queue.dequeue();
        continue;
      }

      const syncDelay = this.getMaxThrottleDelay();
      if (syncDelay > 0) {
        this.scheduledTimer = setTimeout(() => {
          this.scheduledTimer = null;
          this.tryNext();
        }, syncDelay);
        return;
      }

      const { delayMs, permits } = await this.acquireAsyncPermits(peeked);
      if (generationAtStart !== this.generation || this._isPaused) {
        await this.releasePermits(permits);
        return;
      }

      if (delayMs > 0) {
        this.asyncRateLimitedUntil = Date.now() + delayMs;
        this.scheduledTimer = setTimeout(() => {
          this.scheduledTimer = null;
          this.tryNext();
        }, delayMs);
        return;
      }

      if (this.isJobCancelled(peeked)) {
        await this.releasePermits(permits);
        this.queue.dequeue();
        continue;
      }

      const job = this.queue.dequeue();
      if (!job) {
        await this.releasePermits(permits);
        continue;
      }
      if (job !== peeked) {
        await this.releasePermits(permits);
        this.queue.enqueue(job);
        continue;
      }

      try {
        this.runJob(job);
      } catch (error) {
        await this.releasePermits(permits);
        throw error;
      }
    }
  }

  /**
   * Attempts to acquire permits from all async throttlers for a job.
   *
   * @param job - The job requiring permits
   * @returns Object containing delay (if rate limited) and acquired permits
   */
  private async acquireAsyncPermits(
    job: Job<unknown>,
  ): Promise<{ delayMs: number; permits: ThrottlePermit[] }> {
    if (this.asyncThrottlers.length === 0) {
      return { delayMs: 0, permits: [] };
    }

    const context = { job, key: job.rateLimitKey };

    const results = await Promise.allSettled(
      this.asyncThrottlers.map(async (throttler) => throttler.acquire(context)),
    );

    const permits: ThrottlePermit[] = [];
    let maxDelay = 0;
    let firstError: unknown | null = null;

    for (const settled of results) {
      if (settled.status === 'rejected') {
        firstError ??= settled.reason;
        continue;
      }

      const result = settled.value;
      if (result.granted) {
        if (result.permit) {
          permits.push(result.permit);
        }
      } else {
        maxDelay = Math.max(maxDelay, result.delayMs);
      }
    }

    if (firstError) {
      await this.releasePermits(permits);
      throw firstError;
    }

    if (maxDelay > 0) {
      await this.releasePermits(permits);
      return { delayMs: maxDelay, permits: [] };
    }

    return { delayMs: 0, permits };
  }

  /**
   * Releases all acquired async throttler permits.
   *
   * @param permits - Array of permits to release
   */
  private async releasePermits(permits: ThrottlePermit[]): Promise<void> {
    if (permits.length === 0) {
      return;
    }
    await Promise.allSettled(permits.map((permit) => permit.release()));
  }

  /**
   * Executes a job, notifying throttlers and tracking completion.
   *
   * @param job - The job to run
   */
  private runJob(job: Job<unknown>): void {
    this._runningCount++;

    for (const throttler of this.throttlers) {
      throttler.notifyJobStarted();
    }

    job
      .execute()
      .catch(() => {})
      .finally(() => {
        this._runningCount--;
        this.onJobComplete();
      });
  }

  /**
   * Checks if a job has been cancelled.
   *
   * @param job - The job to check
   * @returns True if cancelled, false otherwise
   */
  private isJobCancelled(job: Job<unknown>): boolean {
    return job.status === 'cancelled';
  }

  /**
   * Handles job completion by attempting to start more jobs and checking for idle state.
   */
  private onJobComplete(): void {
    this.tryNext();

    if (this._runningCount === 0 && this.queue.size === 0) {
      this.emitIdle();
    }
  }

  /**
   * Emits the idle event to all registered callbacks.
   */
  private emitIdle(): void {
    if (this.wasActive) {
      this.wasActive = false;
      for (const callback of this.idleCallbacks) {
        callback();
      }
    }
  }

  /**
   * Emits the active event to all registered callbacks.
   */
  private emitActive(): void {
    if (!this.wasActive) {
      this.wasActive = true;
      for (const callback of this.activeCallbacks) {
        callback();
      }
    }
  }
}
