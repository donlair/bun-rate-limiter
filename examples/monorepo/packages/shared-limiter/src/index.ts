import { RedisClient } from 'bun';
import { RateLimiter } from 'bun-rate-limiter';

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
    backend: { type: 'redis', redis, keyPrefix: 'demo' },
    limits: {
      minDelayMs: 2,
      tokenBucket: { capacity: 20, refillAmount: 20, refillInterval: 1000 },
    },
  });

  return {
    limiter,
    close: () => redis.close(),
  };
}
