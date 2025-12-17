import type { IThrottler } from './IThrottler';

export interface IntervalThrottlerOptions {
  /** Maximum number of jobs allowed in the interval */
  limit: number;
  /** The time window in milliseconds */
  interval: number;
}

/**
 * Throttler that limits the number of jobs started within a time window.
 * Uses a sliding window approach where old entries expire.
 */
export class IntervalThrottler implements IThrottler {
  private timestamps: number[] = [];
  readonly limit: number;
  readonly interval: number;

  constructor(options: IntervalThrottlerOptions) {
    this.limit = options.limit;
    this.interval = options.interval;
  }

  /**
   * Get the delay before the next job can start.
   * @returns 0 if a job can start now, or the milliseconds to wait
   */
  getNextRunDelay(): number {
    this.pruneExpired();

    if (this.timestamps.length < this.limit) {
      return 0;
    }

    // biome-ignore lint/style/noNonNullAssertion: Length checked above guarantees element exists
    const oldestTimestamp = this.timestamps[0]!;
    const expiresAt = oldestTimestamp + this.interval;
    const delay = expiresAt - Date.now();

    return Math.max(0, delay);
  }

  /**
   * Notify that a job has started.
   * This adds a timestamp to the tracking window.
   */
  notifyJobStarted(): void {
    this.timestamps.push(Date.now());
  }

  /**
   * Reset the throttler to its initial state.
   */
  reset(): void {
    this.timestamps = [];
  }

  /**
   * Remove expired timestamps from the tracking array.
   */
  private pruneExpired(): void {
    const cutoff = Date.now() - this.interval;
    // biome-ignore lint/style/noNonNullAssertion: Loop condition guarantees element exists
    while (this.timestamps.length > 0 && this.timestamps[0]! < cutoff) {
      this.timestamps.shift();
    }
  }
}
