/**
 * Singleton Rate Limiter for Serverless Environments
 *
 * In serverless (Vercel, AWS Lambda), each function invocation may create a new
 * instance. However, within a single container's lifetime, we can reuse the
 * connection and rate limiter instance.
 *
 * The actual rate limiting state lives in Redis, so it's shared across all
 * serverless instances globally.
 */

import { createClient } from 'redis';
import { RateLimiter, type IRedisClient } from 'bun-rate-limiter';

// Singleton instances - survive across requests in the same container
let redis: ReturnType<typeof createClient> | null = null;
let limiter: RateLimiter | null = null;

/**
 * Adapter: node-redis -> IRedisClient interface
 */
function createRedisAdapter(client: ReturnType<typeof createClient>): IRedisClient {
  return {
    send: async (command: string, args: readonly (string | number)[]) => {
      // node-redis uses sendCommand with array of strings
      return client.sendCommand([command, ...args.map(String)]);
    },
  };
}

/**
 * Get or create the rate limiter singleton.
 * Safe to call multiple times - will reuse existing instance.
 */
export async function getRateLimiter(): Promise<RateLimiter> {
  if (limiter) {
    return limiter;
  }

  // Create Redis connection
  if (!redis) {
    redis = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379',
    });

    redis.on('error', (err) => {
      console.error('Redis connection error:', err);
    });

    await redis.connect();
  }

  // Create rate limiter with distributed limits
  // Configuration: 2000 requests/minute with anti-burst protection
  limiter = new RateLimiter({
    concurrency: 100, // High concurrency for serverless
    backend: {
      type: 'redis',
      redis: createRedisAdapter(redis),
      keyPrefix: 'myapp:api-limiter',
    },
    limits: {
      minDelayMs: 30, // Anti-burst: smooth out requests
      tokenBucket: {
        capacity: 2000, // 2000 requests
        refillAmount: 2000, // Refill fully
        refillInterval: 60_000, // Every minute
      },
    },
    defaultRateLimitKey: 'global', // All requests share global limit
  });

  return limiter;
}

/**
 * Wrapper to execute a function with rate limiting.
 * Use this in your server actions.
 */
export async function withRateLimit<T>(fn: () => Promise<T>): Promise<T> {
  const rl = await getRateLimiter();
  return rl.add(fn);
}
