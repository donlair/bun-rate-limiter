import type { IAsyncThrottler } from '../strategies/throttle/IAsyncThrottler';
import type { IThrottler } from '../strategies/throttle/IThrottler';

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
  /** Minimum delay between task starts in ms (default: 0) */
  requestDelay?: number;
  /** Additional throttlers to apply in addition to `requestDelay` */
  throttlers?: IThrottler[];
  /** Async throttlers (e.g. Redis-backed distributed rate limiting) */
  asyncThrottlers?: IAsyncThrottler[];
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
  next: () => void;
  completed: (result: unknown) => void;
  error: (error: Error) => void;
};
