/**
 * Interface for throttling strategies.
 * Implementations control the rate at which jobs can be started.
 */
export interface IThrottler {
  /**
   * Check if a job can be started now.
   * @returns 0 if ready to run, or milliseconds to wait if throttled
   */
  getNextRunDelay(): number;

  /**
   * Notify the throttler that a job has started.
   * Called immediately when a job begins execution.
   */
  notifyJobStarted(): void;

  /**
   * Reset the throttler to its initial state.
   */
  reset(): void;
}
