import type { IThrottler } from './IThrottler';

/**
 * Throttler that enforces a minimum delay between job starts.
 * This implements the "pacing" or "anti-burst" pattern.
 */
export class SpacingThrottler implements IThrottler {
  private _lastRunTime = 0;

  /**
   * Create a new SpacingThrottler.
   * @param minDelay Minimum milliseconds between job starts
   */
  constructor(public readonly minDelay: number) {}

  /**
   * Get the time when a job was last started.
   */
  get lastRunTime(): number {
    return this._lastRunTime;
  }

  /**
   * Get the delay before the next job can start.
   * @returns 0 if a job can start now, or the milliseconds to wait
   */
  getNextRunDelay(): number {
    if (this._lastRunTime === 0) {
      return 0;
    }

    const elapsed = Date.now() - this._lastRunTime;
    return Math.max(0, this.minDelay - elapsed);
  }

  /**
   * Notify that a job has started.
   * This updates the internal timer.
   */
  notifyJobStarted(): void {
    this._lastRunTime = Date.now();
  }

  /**
   * Reset the throttler to its initial state.
   */
  reset(): void {
    this._lastRunTime = 0;
  }
}
