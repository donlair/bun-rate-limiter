import type { Job } from '../../core/Job';

export interface ThrottlePermit {
  /**
   * Release a previously acquired permit (best-effort).
   * This is used when multiple throttlers are composed and not all can grant.
   */
  release(): Promise<void>;
}

export type AcquireResult =
  | { granted: true; permit?: ThrottlePermit }
  | { granted: false; delayMs: number };

export interface AcquireContext {
  /** Job that is about to start */
  job: Job<unknown>;
  /** Optional key for per-key rate limiting */
  key?: string;
}

/**
 * Interface for async throttling strategies (e.g. Redis-backed distributed rate limiting).
 *
 * Implementations should perform an atomic "acquire" against their backing store and return
 * either a granted permit or a delay until the next attempt should be made.
 */
export interface IAsyncThrottler {
  acquire(context: AcquireContext): Promise<AcquireResult>;
  reset?(): Promise<void>;
}
