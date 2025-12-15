import { describe, expect, test } from 'bun:test';
import { TokenBucketThrottler } from '../../src/strategies/throttle/TokenBucketThrottler.ts';

describe('TokenBucketThrottler', () => {
  describe('getNextRunDelay', () => {
    test('returns 0 initially when bucket has tokens', () => {
      const throttler = new TokenBucketThrottler({
        capacity: 2,
        refillAmount: 1,
        refillInterval: 50,
      });

      expect(throttler.getNextRunDelay()).toBe(0);
    });

    test('returns delay when bucket is empty', () => {
      const throttler = new TokenBucketThrottler({
        capacity: 1,
        refillAmount: 1,
        refillInterval: 50,
      });

      throttler.notifyJobStarted(); // consume the only token

      const delay = throttler.getNextRunDelay();
      expect(delay).toBeGreaterThan(0);
      expect(delay).toBeLessThanOrEqual(50);
    });

    test('returns 0 after enough time passes to refill', async () => {
      const throttler = new TokenBucketThrottler({
        capacity: 1,
        refillAmount: 1,
        refillInterval: 30,
      });

      throttler.notifyJobStarted(); // consume token
      expect(throttler.getNextRunDelay()).toBeGreaterThan(0);

      await new Promise((resolve) => setTimeout(resolve, 40));

      expect(throttler.getNextRunDelay()).toBe(0);
    });

    test('supports initialTokens', () => {
      const throttler = new TokenBucketThrottler({
        capacity: 5,
        refillAmount: 1,
        refillInterval: 100,
        initialTokens: 0,
      });

      expect(throttler.getNextRunDelay()).toBeGreaterThan(0);
    });
  });

  describe('notifyJobStarted', () => {
    test('consumes tokens', () => {
      const throttler = new TokenBucketThrottler({
        capacity: 2,
        refillAmount: 1,
        refillInterval: 100,
      });

      expect(throttler.getNextRunDelay()).toBe(0);
      throttler.notifyJobStarted();
      expect(throttler.getNextRunDelay()).toBe(0);
      throttler.notifyJobStarted();
      expect(throttler.getNextRunDelay()).toBeGreaterThan(0);
    });
  });

  describe('reset', () => {
    test('restores the bucket to full capacity', () => {
      const throttler = new TokenBucketThrottler({
        capacity: 1,
        refillAmount: 1,
        refillInterval: 1000,
      });

      throttler.notifyJobStarted();
      expect(throttler.getNextRunDelay()).toBeGreaterThan(0);

      throttler.reset();
      expect(throttler.getNextRunDelay()).toBe(0);
    });
  });
});
