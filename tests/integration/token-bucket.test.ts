import { describe, expect, test } from 'bun:test';
import { RateLimiter } from '../../src/index.ts';
import { TokenBucketThrottler } from '../../src/strategies/throttle/TokenBucketThrottler.ts';

describe('token bucket integration', () => {
  test('RateLimiter honors custom throttlers', async () => {
    const throttler = new TokenBucketThrottler({
      capacity: 1,
      refillAmount: 1,
      refillInterval: 30,
      initialTokens: 0,
    });

    const queue = new RateLimiter({
      concurrency: 5,
      throttlers: [throttler],
    });

    expect(queue.isRateLimited).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(queue.isRateLimited).toBe(false);
  });
});
