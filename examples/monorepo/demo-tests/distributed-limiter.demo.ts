import { describe, expect, test } from 'bun:test';
import { RedisClient } from 'bun';
import { startApiServer } from '../apps/api/src/index';
import { runClient as runClientA } from '../apps/client-a/src/index';
import { runClient as runClientB } from '../apps/client-b/src/index';

async function canConnectRedis(redisUrl: string): Promise<boolean> {
  const redis = new RedisClient(redisUrl);
  try {
    await Promise.race([
      redis.connect(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 500)),
    ]);
    await redis.send('PING', []);
    return true;
  } catch {
    return false;
  } finally {
    redis.close();
  }
}

describe('shared redis limiter', () => {
  test('prevents 429s when two clients run concurrently', async () => {
    const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
    expect(await canConnectRedis(redisUrl)).toBe(true);

    const api = startApiServer({ port: 0 });
    try {
      const [a429, b429] = await Promise.all([
        runClientA({ apiUrl: api.url, redisUrl, name: 'client-a', count: 60 }),
        runClientB({ apiUrl: api.url, redisUrl, name: 'client-b', count: 60 }),
      ]);

      expect(a429).toBe(0);
      expect(b429).toBe(0);
    } finally {
      api.stop();
    }
  });
});

