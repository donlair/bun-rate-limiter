import { RedisClient } from 'bun';
import { RateLimiter, RedisSpacingThrottler, RedisTokenBucketThrottler } from 'bun-rate-limiter';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

const redis = new RedisClient(requireEnv('REDIS_URL'));
await redis.connect();

try {
  const limiter = new RateLimiter({
    concurrency: 50,
    asyncThrottlers: [
      // Global min spacing between starts (shared across processes).
      new RedisSpacingThrottler({ redis, minDelayMs: 50 }),
      // Global burst + refill.
      new RedisTokenBucketThrottler({
        redis,
        keyPrefix: 'example:bun-rate-limiter:',
        capacity: 5,
        refillAmount: 5,
        refillInterval: 1000,
      }),
    ],
  });

  const startedAt = Date.now();

  const tasks = Array.from({ length: 20 }, (_, index) => async () => {
    const elapsedMs = Date.now() - startedAt;
    console.log(`[${String(elapsedMs).padStart(5)}ms] start job ${index}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
    return index;
  });

  const results = await limiter.addAll(tasks, { rateLimitKey: 'global' });
  console.log('done:', results.length);
} finally {
  redis.close();
}

