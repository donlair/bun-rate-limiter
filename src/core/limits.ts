import type { IAsyncThrottler } from '../strategies/throttle/IAsyncThrottler';
import { IntervalThrottler } from '../strategies/throttle/IntervalThrottler';
import type { IThrottler } from '../strategies/throttle/IThrottler';
import type { IRedisClient } from '../strategies/throttle/redis/IRedisClient';
import { RedisSpacingThrottler } from '../strategies/throttle/redis/RedisSpacingThrottler';
import { RedisTokenBucketThrottler } from '../strategies/throttle/redis/RedisTokenBucketThrottler';
import { SpacingThrottler } from '../strategies/throttle/SpacingThrottler';
import { TokenBucketThrottler } from '../strategies/throttle/TokenBucketThrottler';

/**
 * Token bucket algorithm configuration for rate limiting.
 */
export interface TokenBucketLimits {
  /** Maximum number of tokens in the bucket */
  capacity: number;
  /** Number of tokens to add per refill interval */
  refillAmount: number;
  /** Time in milliseconds between token refills */
  refillInterval: number;
}

/**
 * Interval-based rate limiting configuration.
 */
export interface IntervalLimits {
  /** Maximum number of operations allowed per interval */
  limit: number;
  /** Time window in milliseconds */
  interval: number;
}

export type RateLimiterLimits =
  | {
      /** Minimum spacing between job starts (per key). */
      minDelayMs?: number;
      /** Burst + refill rate. */
      tokenBucket?: TokenBucketLimits;
      interval?: never;
    }
  | {
      /** Minimum spacing between job starts (per key). */
      minDelayMs?: number;
      /** Strict cap per moving window. */
      interval?: IntervalLimits;
      tokenBucket?: never;
    };

/**
 * Redis backend configuration for distributed rate limiting.
 */
export interface RedisBackendOptions {
  type: 'redis';
  /** Redis client instance compatible with IRedisClient interface */
  redis: IRedisClient;
  /**
   * Base prefix for Redis keys used by this limiter.
   * The library will derive per-strategy subkeys under this prefix.
   */
  keyPrefix?: string;
  /** Default key when no per-task key is provided */
  defaultKey?: string;
}

/**
 * Union type for all supported backend options.
 */
export type BackendOptions = RedisBackendOptions;

function normalizePrefix(prefix: string): string {
  if (prefix.length === 0) {
    return '';
  }
  return prefix.endsWith(':') ? prefix : `${prefix}:`;
}

/**
 * Builds synchronous throttlers from rate limit configuration.
 * Used for local in-process rate limiting.
 *
 * @param limits - Rate limiter configuration
 * @returns Array of instantiated throttlers
 */
export function buildThrottlersFromLimits(limits: RateLimiterLimits): IThrottler[] {
  const throttlers: IThrottler[] = [];
  const minDelayMs = limits.minDelayMs ?? 0;
  if (minDelayMs > 0) {
    throttlers.push(new SpacingThrottler(minDelayMs));
  }

  if (limits.interval) {
    throttlers.push(new IntervalThrottler(limits.interval));
  } else if (limits.tokenBucket) {
    throttlers.push(new TokenBucketThrottler(limits.tokenBucket));
  }

  return throttlers;
}

/**
 * Builds asynchronous throttlers from rate limit configuration and Redis backend.
 * Used for distributed rate limiting across multiple processes.
 *
 * @param limits - Rate limiter configuration
 * @param backend - Redis backend configuration
 * @returns Array of instantiated async throttlers
 * @throws Error if interval limits are specified (not supported with Redis backend)
 */
export function buildAsyncThrottlersFromLimits(
  limits: RateLimiterLimits,
  backend: RedisBackendOptions,
): IAsyncThrottler[] {
  const asyncThrottlers: IAsyncThrottler[] = [];
  const basePrefix = normalizePrefix(backend.keyPrefix ?? 'bun-rate-limiter');
  const defaultKey = backend.defaultKey;

  const minDelayMs = limits.minDelayMs ?? 0;
  if (minDelayMs > 0) {
    asyncThrottlers.push(
      new RedisSpacingThrottler({
        redis: backend.redis,
        keyPrefix: `${basePrefix}spacing:`,
        defaultKey,
        minDelayMs,
      }),
    );
  }

  if (limits.interval) {
    throw new Error(
      'RateLimiter: Redis backend does not support interval limits; use tokenBucket limits instead',
    );
  }

  if (limits.tokenBucket) {
    asyncThrottlers.push(
      new RedisTokenBucketThrottler({
        redis: backend.redis,
        keyPrefix: `${basePrefix}token-bucket:`,
        defaultKey,
        ...limits.tokenBucket,
      }),
    );
  }

  return asyncThrottlers;
}
