import type { Job } from '../core/Job';

/**
 * Interface for job schedulers.
 * The scheduler coordinates job execution respecting concurrency and throttling.
 */
export interface IScheduler {
  /** Maximum number of concurrent jobs */
  concurrency: number;

  /** Number of jobs currently waiting in the queue */
  readonly pendingCount: number;

  /** Number of jobs currently running */
  readonly runningCount: number;

  /** Whether the scheduler is paused */
  readonly isPaused: boolean;

  /** Whether the scheduler is currently rate limited by any throttler */
  readonly isRateLimited: boolean;

  /** Whether the scheduler is saturated (at concurrency limit OR rate limited) */
  readonly isSaturated: boolean;

  /** Add a job to be scheduled */
  add(job: Job<unknown>): void;

  /** Start processing jobs */
  start(): void;

  /** Pause processing (running jobs will complete) */
  pause(): void;

  /** Attempt to start the next job if conditions allow */
  tryNext(): void;

  /** Remove all pending jobs */
  clear(): void;

  /** Register a callback for when the queue becomes idle */
  onIdle(callback: () => void): () => void;

  /** Register a callback for when the queue becomes active */
  onActive(callback: () => void): () => void;
}
