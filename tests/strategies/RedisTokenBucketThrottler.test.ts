import { describe, expect, mock, test } from 'bun:test';
import { Job } from '../../src/core/Job.ts';
import type { IRedisClient } from '../../src/strategies/throttle/redis/IRedisClient.ts';
import { RedisTokenBucketThrottler } from '../../src/strategies/throttle/redis/RedisTokenBucketThrottler.ts';

describe('RedisTokenBucketThrottler', () => {
  test('acquire calls EVAL and grants with a releasable permit', async () => {
    const send = mock(async () => [1, 0]);
    const redis: IRedisClient = { send };

    const throttler = new RedisTokenBucketThrottler({
      redis,
      keyPrefix: 'test:',
      capacity: 5,
      refillAmount: 1,
      refillInterval: 1000,
    });

    const job = new Job(async () => 'result', { rateLimitKey: 'user:123' });
    const result = await throttler.acquire({ job, key: 'explicit' });

    expect(result.granted).toBe(true);
    expect(result.granted && result.permit).toBeTruthy();

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('EVAL', expect.any(Array));

    // script, numkeys, key, ...
    // biome-ignore lint/style/noNonNullAssertion: mock call shape is controlled by the test
    const args = send.mock.calls[0]![1] as string[];
    expect(args[2]).toBe('test:explicit');

    await result.permit?.release();

    expect(send).toHaveBeenCalledTimes(2);
    // biome-ignore lint/style/noNonNullAssertion: second call exists
    const releaseArgs = send.mock.calls[1]![1] as string[];
    expect(releaseArgs[2]).toBe('test:explicit');
  });

  test('acquire returns delay when Redis denies', async () => {
    const send = mock(async () => [0, 42]);
    const redis: IRedisClient = { send };

    const throttler = new RedisTokenBucketThrottler({
      redis,
      keyPrefix: 'test:',
      capacity: 1,
      refillAmount: 1,
      refillInterval: 1000,
    });

    const job = new Job(async () => 'result', { rateLimitKey: 'user:123' });
    const result = await throttler.acquire({ job });

    expect(result).toEqual({ granted: false, delayMs: 42 });
    expect(send).toHaveBeenCalledTimes(1);
  });
});
