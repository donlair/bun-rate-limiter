import type { IAsyncThrottler } from '../strategies/throttle/IAsyncThrottler';
import { IntervalThrottler } from '../strategies/throttle/IntervalThrottler';
import type { IThrottler } from '../strategies/throttle/IThrottler';
import type { IRedisClient } from '../strategies/throttle/redis/IRedisClient';
import { RedisSpacingThrottler } from '../strategies/throttle/redis/RedisSpacingThrottler';
import { RedisTokenBucketThrottler } from '../strategies/throttle/redis/RedisTokenBucketThrottler';
import { SpacingThrottler } from '../strategies/throttle/SpacingThrottler';
import { TokenBucketThrottler } from '../strategies/throttle/TokenBucketThrottler';

export interface TokenBucketLimits {
  capacity: number;
  refillAmount: number;
  refillInterval: number;
}

export interface IntervalLimits {
  limit: number;
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

export interface RedisBackendOptions {
  type: 'redis';
  redis: IRedisClient;
  /**
   * Base prefix for Redis keys used by this limiter.
   * The library will derive per-strategy subkeys under this prefix.
   */
  keyPrefix?: string;
  /** Default key when no per-task key is provided */
  defaultKey?: string;
}

export type BackendOptions = RedisBackendOptions;

function normalizePrefix(prefix: string): string {
  if (prefix.length === 0) {
    return '';
  }
  return prefix.endsWith(':') ? prefix : `${prefix}:`;
}

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
