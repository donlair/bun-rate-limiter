import { describe, expect, mock, test } from 'bun:test';
import { Job } from '../../src/core/Job';
import type { IRedisClient } from '../../src/strategies/throttle/redis/IRedisClient';
import { RedisSpacingThrottler } from '../../src/strategies/throttle/redis/RedisSpacingThrottler';

describe('RedisSpacingThrottler', () => {
  test('acquire calls EVAL and grants with a releasable permit', async () => {
    const send = mock(async (_command: string, _args: readonly (string | number)[]) => {
      // [granted, acquiredAtMs, previousMs]
      return [1, 123, 0];
    });
    const redis: IRedisClient = { send };

    const throttler = new RedisSpacingThrottler({ redis, minDelayMs: 3 });
    const result = await throttler.acquire({ job: new Job(async () => 1), key: 'global' });

    expect(send).toHaveBeenCalledTimes(1);
    expect(result.granted).toBe(true);
    if (result.granted && result.permit) {
      await result.permit.release();
      expect(send).toHaveBeenCalledTimes(2);
    }
  });

  test('acquire returns delay when Redis denies', async () => {
    const send = mock(async (_command: string, _args: readonly (string | number)[]) => {
      // [granted, delayMs]
      return [0, 17];
    });
    const redis: IRedisClient = { send };

    const throttler = new RedisSpacingThrottler({ redis, minDelayMs: 3 });
    const result = await throttler.acquire({ job: new Job(async () => 1), key: 'global' });

    expect(result).toEqual({ granted: false, delayMs: 17 });
  });
});
