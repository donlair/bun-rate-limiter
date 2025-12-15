import { RedisClient } from 'bun';
import { RateLimiter, RedisSpacingThrottler, RedisTokenBucketThrottler } from 'bun-rate-limiter';

export interface SharedLimiterOptions {
  redisUrl: string;
  apiKey?: string;
}

export interface SharedLimiter {
  limiter: RateLimiter;
  close: () => void;
}

/**
 * Creates a Redis-backed limiter that can be used by multiple apps/processes.
 * The limits are tuned to the demo API:
 * - global minimum spacing: 2ms between starts (prevents 5-in-5ms bursts)
 * - global token bucket: 20 per second with burst capacity 20
 */
export async function createSharedLimiter(options: SharedLimiterOptions): Promise<SharedLimiter> {
  const redis = new RedisClient(options.redisUrl);
  await redis.connect();

  const limiter = new RateLimiter({
    concurrency: 100,
    asyncThrottlers: [
      new RedisSpacingThrottler({
        redis,
        keyPrefix: 'demo:spacing:',
        minDelayMs: 2,
      }),
      new RedisTokenBucketThrottler({
        redis,
        keyPrefix: 'demo:bucket:',
        capacity: 20,
        refillAmount: 20,
        refillInterval: 1000,
      }),
    ],
  });

  return {
    limiter,
    close: () => redis.close(),
  };
}

