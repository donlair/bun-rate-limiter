/**
 * Node.js Example: Using bun-rate-limiter with ioredis
 *
 * This example demonstrates:
 * - Creating an IRedisClient adapter for ioredis
 * - Distributed rate limiting with 2000 requests/minute + anti-burst
 * - Running on standard Node.js (no Bun required)
 */

import Redis from 'ioredis';
import { RateLimiter, type IRedisClient } from 'bun-rate-limiter';

// Create ioredis instance
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

// Adapter: ioredis -> IRedisClient interface
// The library only needs a `send(command, args)` method
const redisClient: IRedisClient = {
  send: (command: string, args: readonly (string | number)[]) =>
    redis.call(command, ...args) as Promise<unknown>,
};

// Create rate limiter with distributed limits
// This configuration enforces:
// - 2000 requests per minute (via token bucket)
// - Anti-burst: at least 30ms between requests (smooths out traffic)
const limiter = new RateLimiter({
  concurrency: 50,
  backend: { type: 'redis', redis: redisClient, keyPrefix: 'myapp:rl' },
  limits: {
    minDelayMs: 30, // Anti-burst: ~33 requests/second max burst
    tokenBucket: {
      capacity: 2000, // Allow burst up to 2000
      refillAmount: 2000, // Refill 2000 tokens
      refillInterval: 60_000, // Every 60 seconds
    },
  },
  defaultRateLimitKey: 'api', // All tasks share this rate limit
});

// Simulate API calls
async function fetchData(id: number): Promise<string> {
  // Simulate API latency
  await new Promise((resolve) => setTimeout(resolve, 10));
  return `Data for ${id}`;
}

async function main() {
  console.log('Starting distributed rate-limited requests...');
  console.log('Config: 2000/min with 30ms anti-burst spacing');
  console.log('');

  const startTime = Date.now();
  const results: string[] = [];

  // Queue 100 requests
  const promises = Array.from({ length: 100 }, (_, i) =>
    limiter.add(() => fetchData(i + 1))
  );

  // Wait for all to complete
  for (const promise of promises) {
    const result = await promise;
    results.push(result);
    process.stdout.write(`\rCompleted: ${results.length}/100`);
  }

  const elapsed = Date.now() - startTime;
  console.log(`\n\nCompleted 100 requests in ${elapsed}ms`);
  console.log(`Average: ${(elapsed / 100).toFixed(1)}ms per request`);

  // Cleanup
  await redis.quit();
}

main().catch(console.error);
