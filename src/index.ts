import { EventBus } from './core/EventBus';
import { Job } from './core/Job';
import type { RateLimiterEvents, RateLimiterOptions, Task, TaskOptions } from './core/types';
import { StandardScheduler } from './scheduler/StandardScheduler';
import { PriorityQueue } from './strategies/queue/PriorityQueue';
import { SpacingThrottler } from './strategies/throttle/SpacingThrottler';

export { EventBus } from './core/EventBus';
export { TimeoutError } from './core/errors';
export { Job, type JobOptions } from './core/Job';
export type {
  JobStatus,
  RateLimiterEvents,
  RateLimiterOptions,
  Task,
  TaskOptions,
} from './core/types';
export type { IScheduler } from './scheduler/IScheduler';
export { StandardScheduler, type StandardSchedulerOptions } from './scheduler/StandardScheduler';
export { ArrayQueue } from './strategies/queue/ArrayQueue';
export type { IQueue } from './strategies/queue/IQueue';
export { type Comparator, PriorityQueue } from './strategies/queue/PriorityQueue';
export type {
  AcquireContext,
  AcquireResult,
  IAsyncThrottler,
  ThrottlePermit,
} from './strategies/throttle/IAsyncThrottler';
export {
  IntervalThrottler,
  type IntervalThrottlerOptions,
} from './strategies/throttle/IntervalThrottler';
export type { IThrottler } from './strategies/throttle/IThrottler';
export type { IRedisClient } from './strategies/throttle/redis/IRedisClient';
export {
  RedisSpacingThrottler,
  type RedisSpacingThrottlerOptions,
} from './strategies/throttle/redis/RedisSpacingThrottler';
export {
  RedisTokenBucketThrottler,
  type RedisTokenBucketThrottlerOptions,
} from './strategies/throttle/redis/RedisTokenBucketThrottler';
export { SpacingThrottler } from './strategies/throttle/SpacingThrottler';
export {
  TokenBucketThrottler,
  type TokenBucketThrottlerOptions,
} from './strategies/throttle/TokenBucketThrottler';

/**
 * RateLimiter - A modern, modular concurrency queue for Bun.
 *
 * @example
 * ```typescript
 * const queue = new RateLimiter({ concurrency: 5, requestDelay: 100 });
 *
 * const result = await queue.add(async () => {
 *   return await fetch('https://api.example.com/data');
 * });
 * ```
 */
export class RateLimiter {
  private readonly scheduler: StandardScheduler;
  private readonly events: EventBus<RateLimiterEvents>;
  private readonly defaultTimeout?: number;

  constructor(options: RateLimiterOptions = {}) {
    const {
      concurrency = 1,
      requestDelay = 0,
      autoStart = true,
      timeout,
      throttlers = [],
      asyncThrottlers = [],
    } = options;
    this.defaultTimeout = timeout;

    // Create event bus
    this.events = new EventBus();

    // Create priority queue for jobs (higher priority first)
    const queue = new PriorityQueue<Job<unknown>>((a, b) => a.priority - b.priority);

    // Create throttler if requestDelay is specified
    const requestDelayThrottler = requestDelay > 0 ? new SpacingThrottler(requestDelay) : null;
    const allThrottlers = requestDelayThrottler
      ? [...throttlers, requestDelayThrottler]
      : throttlers;

    // Create scheduler
    this.scheduler = new StandardScheduler(queue, allThrottlers, {
      concurrency,
      autoStart,
      asyncThrottlers,
    });

    // Wire up events
    this.scheduler.onIdle(() => this.events.emit('idle'));
    this.scheduler.onActive(() => this.events.emit('active'));
  }

  /**
   * Number of tasks waiting in the queue.
   */
  get size(): number {
    return this.scheduler.pendingCount;
  }

  /**
   * Number of tasks currently running.
   * (Matches p-queue convention)
   */
  get pending(): number {
    return this.scheduler.runningCount;
  }

  /**
   * Number of tasks currently running.
   * (Explicit alias for pending)
   */
  get runningCount(): number {
    return this.scheduler.runningCount;
  }

  /**
   * Whether the queue is paused.
   */
  get isPaused(): boolean {
    return this.scheduler.isPaused;
  }

  /**
   * Whether the queue is currently rate limited by any throttler.
   */
  get isRateLimited(): boolean {
    return this.scheduler.isRateLimited;
  }

  /**
   * Whether the queue is saturated (at concurrency limit OR rate limited).
   */
  get isSaturated(): boolean {
    return this.scheduler.isSaturated;
  }

  /**
   * Add a task to the queue.
   *
   * @param fn The async function to execute
   * @param options Task options (priority, signal, timeout)
   * @returns Promise that resolves with the task result
   */
  add<T>(fn: Task<T>, options: TaskOptions = {}): Promise<T> {
    const job = new Job(fn, {
      priority: options.priority ?? 0,
      rateLimitKey: options.rateLimitKey,
      signal: options.signal,
      timeout: options.timeout ?? this.defaultTimeout,
    });

    // Wire up job events
    job.promise
      .then((result) => {
        this.events.emit('completed', result);
      })
      .catch((error) => {
        this.events.emit('error', error instanceof Error ? error : new Error(String(error)));
      });

    this.events.emit('add');
    this.scheduler.add(job as Job<unknown>);

    return job.promise;
  }

  /**
   * Add multiple tasks to the queue.
   *
   * @param fns Array of async functions to execute
   * @param options Task options applied to all tasks
   * @returns Promise that resolves with all task results
   */
  addAll<T>(fns: Task<T>[], options: TaskOptions = {}): Promise<T[]> {
    return Promise.all(fns.map((fn) => this.add(fn, options)));
  }

  /**
   * Pause the queue. Running tasks will complete.
   */
  pause(): void {
    this.scheduler.pause();
  }

  /**
   * Start/resume the queue.
   */
  start(): void {
    this.scheduler.start();
  }

  /**
   * Remove all pending tasks from the queue.
   */
  clear(): void {
    this.scheduler.clear();
  }

  /**
   * Reset async throttler state (e.g. distributed rate limiter backends).
   * Does not remove pending tasks; it only resets the async throttlers.
   */
  resetAsyncThrottlers(): Promise<void> {
    return this.scheduler.resetAsyncThrottlers();
  }

  /**
   * Subscribe to queue events.
   *
   * @param event Event name
   * @param handler Event handler
   * @returns Unsubscribe function
   */
  on<K extends keyof RateLimiterEvents>(event: K, handler: RateLimiterEvents[K]): () => void {
    return this.events.on(event, handler);
  }

  /**
   * Subscribe to a queue event once.
   *
   * @param event Event name
   * @param handler Event handler
   * @returns Unsubscribe function
   */
  once<K extends keyof RateLimiterEvents>(event: K, handler: RateLimiterEvents[K]): () => void {
    return this.events.once(event, handler);
  }

  /**
   * Unsubscribe from queue events.
   *
   * @param event Event name
   * @param handler Event handler to remove
   */
  off<K extends keyof RateLimiterEvents>(event: K, handler: RateLimiterEvents[K]): void {
    this.events.off(event, handler);
  }
}

export default RateLimiter;
