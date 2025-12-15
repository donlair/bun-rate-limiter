import { describe, expect, test } from 'bun:test';
import { startApiServer } from '../apps/api/src/index';

describe('demo api rate limits', () => {
  test('returns 429 when bursting (>=5 requests within 5ms)', async () => {
    const api = startApiServer({ port: 0 });
    try {
      const responses = await Promise.all(
        Array.from({ length: 10 }, () => fetch(`${api.url}/data`)),
      );
      const statuses = responses.map((r) => r.status);
      expect(statuses).toContain(429);
    } finally {
      api.stop();
    }
  });

  test('returns 429 when exceeding 20 requests within 1 second', async () => {
    const api = startApiServer({ port: 0 });
    try {
      const responses = await Promise.all(
        Array.from({ length: 30 }, () => fetch(`${api.url}/data`)),
      );
      const statuses = responses.map((r) => r.status);
      expect(statuses).toContain(429);
    } finally {
      api.stop();
    }
  });
});

