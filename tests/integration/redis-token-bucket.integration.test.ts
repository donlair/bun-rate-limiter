import { describe, expect, test } from 'bun:test';
import { RedisClient } from 'bun';
import { RateLimiter, RedisTokenBucketThrottler } from '../../src/index.ts';

const maybeTest = process.env.REDIS_URL ? test : test.skip;

describe('redis token bucket integration (optional)', () => {
  maybeTest('enforces token bucket pacing via Redis', async () => {
    const client = new RedisClient(process.env.REDIS_URL);
    await client.connect();

    const keyPrefix = `bun-rate-limiter:test:${Date.now()}:${Math.random().toString(16).slice(2)}:`;
    const rateLimitKey = 'bucket:a';

    const throttler = new RedisTokenBucketThrottler({
      redis: client,
      keyPrefix,
      capacity: 2,
      refillAmount: 1,
      refillInterval: 100,
    });

    const queue = new RateLimiter({
      concurrency: 10,
      asyncThrottlers: [throttler],
    });

    const start = Date.now();
    const startTimes: number[] = [];

    const tasks = Array.from({ length: 5 }, () =>
      queue.add(
        async () => {
          startTimes.push(Date.now() - start);
          await new Promise((resolve) => setTimeout(resolve, 5));
          return 'ok';
        },
        { rateLimitKey },
      ),
    );

    await Promise.all(tasks);

    // Token bucket should allow an initial burst of 2.
    expect(startTimes[0]).toBeLessThan(80);
    expect(startTimes[1]).toBeLessThan(80);

    // Then roughly 1 token per 100ms.
    expect(startTimes[2]).toBeGreaterThanOrEqual(80);
    expect(startTimes[3]).toBeGreaterThanOrEqual(180);
    expect(startTimes[4]).toBeGreaterThanOrEqual(280);

    await client.send('DEL', [`${keyPrefix}${rateLimitKey}`]);
    client.close();
  });

  maybeTest('uses per-task rateLimitKey for Redis keying', async () => {
    const client = new RedisClient(process.env.REDIS_URL);
    await client.connect();

    const keyPrefix = `bun-rate-limiter:test:${Date.now()}:${Math.random().toString(16).slice(2)}:`;

    const throttler = new RedisTokenBucketThrottler({
      redis: client,
      keyPrefix,
      capacity: 1,
      refillAmount: 1,
      refillInterval: 1000,
    });

    const queue = new RateLimiter({
      concurrency: 1,
      asyncThrottlers: [throttler],
    });

    await queue.add(async () => 'ok', { rateLimitKey: 'user:123' });

    const exists = await client.send('EXISTS', [`${keyPrefix}user:123`]);
    expect(Boolean(exists)).toBe(true);

    await client.send('DEL', [`${keyPrefix}user:123`]);
    client.close();
  });
});
