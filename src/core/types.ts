import type { IAsyncThrottler } from '../strategies/throttle/IAsyncThrottler';
import type { IThrottler } from '../strategies/throttle/IThrottler';
import type { BackendOptions, RateLimiterLimits } from './limits';

/**
 * A task function that returns a promise.
 * Receives an optional AbortSignal for cancellation support.
 */
export type Task<T> = (context: { signal?: AbortSignal }) => Promise<T>;

/**
 * Options for individual task submission
 */
export interface TaskOptions {
  /** Priority level (higher = processed first) */
  priority?: number;
  /** Optional per-key identifier for distributed rate limiting */
  rateLimitKey?: string;
  /** AbortSignal for task cancellation */
  signal?: AbortSignal;
  /** Timeout in milliseconds (0 or undefined = no timeout) */
  timeout?: number;
}

/**
 * Configuration options for RateLimiter
 */
export interface RateLimiterOptions {
  /** Maximum number of concurrent tasks (default: 1) */
  concurrency?: number;
  /**
   * Happy-path rate limit configuration.
   * Use this unless you need custom throttler behavior.
   */
  limits?: RateLimiterLimits;
  /**
   * Optional backend for distributed rate limiting.
   * If omitted, limits are enforced locally in-process.
   */
  backend?: BackendOptions;
  /**
   * Advanced escape hatch: manually provide throttlers.
   * If you specify these alongside `limits`, you must set `compose: true`.
   */
  throttlers?: IThrottler[];
  /** Advanced escape hatch: manually provide async throttlers. */
  asyncThrottlers?: IAsyncThrottler[];
  /**
   * If true, `limits` are composed with any provided `throttlers` / `asyncThrottlers`.
   * If false, specifying both will throw (to avoid accidental double-throttling).
   */
  compose?: boolean;
  /** Default key used when a task omits `rateLimitKey`. */
  defaultRateLimitKey?: string;
  /** Whether to start processing immediately (default: true) */
  autoStart?: boolean;
  /** Default timeout in milliseconds for all tasks (0 or undefined = no timeout) */
  timeout?: number;
}

/**
 * Job status states
 */
export type JobStatus = 'pending' | 'running' | 'completed' | 'cancelled' | 'failed';

/**
 * Event types emitted by RateLimiter
 */
export type RateLimiterEvents = {
  active: () => void;
  idle: () => void;
  add: () => void;
  completed: (result: unknown) => void;
  error: (error: Error) => void;
};
