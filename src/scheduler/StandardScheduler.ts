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

  get pendingCount(): number {
    return this.queue.size;
  }

  get runningCount(): number {
    return this._runningCount;
  }

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

  add(job: Job<unknown>): void {
    const wasEmpty = this.queue.size === 0 && this._runningCount === 0;
    this.queue.enqueue(job);

    if (wasEmpty && !this._isPaused) {
      this.emitActive();
    }

    this.tryNext();
  }

  start(): void {
    this._isPaused = false;
    this.tryNext();
  }

  pause(): void {
    this._isPaused = true;
    if (this.scheduledTimer) {
      clearTimeout(this.scheduledTimer);
      this.scheduledTimer = null;
    }
  }

  tryNext(): void {
    if (this._isPaused) {
      return;
    }

    // Cancel any pending scheduled attempt
    if (this.scheduledTimer) {
      clearTimeout(this.scheduledTimer);
      this.scheduledTimer = null;
    }

    if (this.asyncThrottlers.length === 0) {
      // Sync-only fast path
      while (this._runningCount < this._concurrency && this.queue.size > 0) {
        // Check throttlers
        const maxDelay = this.getMaxThrottleDelay();

        if (maxDelay > 0) {
          // Schedule retry after delay
          this.scheduledTimer = setTimeout(() => {
            this.scheduledTimer = null;
            this.tryNext();
          }, maxDelay);
          return;
        }

        // Dequeue and run the job
        const job = this.queue.dequeue();
        if (!job) {
          break;
        }

        // Skip cancelled jobs without consuming throttler state
        if (job.status === 'cancelled') {
          continue;
        }

        this.runJob(job);
      }

      return;
    }

    this.requestProcessLoop();
  }

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

  onIdle(callback: () => void): () => void {
    this.idleCallbacks.add(callback);
    return () => {
      this.idleCallbacks.delete(callback);
    };
  }

  onActive(callback: () => void): () => void {
    this.activeCallbacks.add(callback);
    return () => {
      this.activeCallbacks.delete(callback);
    };
  }

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

      // Drop cancelled jobs without consuming throttler state
      if (this.isJobCancelled(peeked)) {
        this.queue.dequeue();
        continue;
      }

      // Check sync throttlers first to avoid acquiring distributed permits when we already know we must wait
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

      // Acquire succeeded, but the job may have been cancelled while we were awaiting.
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
        // Queue ordering changed unexpectedly; put the job back and retry.
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

  private async releasePermits(permits: ThrottlePermit[]): Promise<void> {
    if (permits.length === 0) {
      return;
    }
    await Promise.allSettled(permits.map((permit) => permit.release()));
  }

  private runJob(job: Job<unknown>): void {
    this._runningCount++;

    // Notify all throttlers
    for (const throttler of this.throttlers) {
      throttler.notifyJobStarted();
    }

    // Execute the job
    job
      .execute()
      .catch(() => {
        // Error is handled by the job itself
      })
      .finally(() => {
        this._runningCount--;
        this.onJobComplete();
      });
  }

  private isJobCancelled(job: Job<unknown>): boolean {
    return job.status === 'cancelled';
  }

  private onJobComplete(): void {
    // Try to start more jobs
    this.tryNext();

    // Check if we've become idle
    if (this._runningCount === 0 && this.queue.size === 0) {
      this.emitIdle();
    }
  }

  private emitIdle(): void {
    if (this.wasActive) {
      this.wasActive = false;
      for (const callback of this.idleCallbacks) {
        callback();
      }
    }
  }

  private emitActive(): void {
    if (!this.wasActive) {
      this.wasActive = true;
      for (const callback of this.activeCallbacks) {
        callback();
      }
    }
  }
}
