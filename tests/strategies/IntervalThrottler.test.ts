import { describe, expect, test } from 'bun:test';
import { IntervalThrottler } from '../../src/strategies/throttle/IntervalThrottler.ts';

describe('IntervalThrottler', () => {
  describe('getNextRunDelay', () => {
    test('returns 0 initially', () => {
      const throttler = new IntervalThrottler({ limit: 5, interval: 1000 });

      expect(throttler.getNextRunDelay()).toBe(0);
    });

    test('returns 0 when under limit', () => {
      const throttler = new IntervalThrottler({ limit: 5, interval: 1000 });

      throttler.notifyJobStarted();
      throttler.notifyJobStarted();
      throttler.notifyJobStarted();

      // Still under limit (3 < 5)
      expect(throttler.getNextRunDelay()).toBe(0);
    });

    test('returns delay when limit reached', () => {
      const throttler = new IntervalThrottler({ limit: 3, interval: 1000 });

      throttler.notifyJobStarted();
      throttler.notifyJobStarted();
      throttler.notifyJobStarted();

      // Limit reached (3 >= 3)
      const delay = throttler.getNextRunDelay();
      expect(delay).toBeGreaterThan(0);
      expect(delay).toBeLessThanOrEqual(1000);
    });

    test('returns 0 after interval passes', async () => {
      const throttler = new IntervalThrottler({ limit: 2, interval: 50 });

      throttler.notifyJobStarted();
      throttler.notifyJobStarted();

      // Limit reached
      expect(throttler.getNextRunDelay()).toBeGreaterThan(0);

      // Wait for interval to pass
      await new Promise((resolve) => setTimeout(resolve, 60));

      // Should be able to run again
      expect(throttler.getNextRunDelay()).toBe(0);
    });
  });

  describe('notifyJobStarted', () => {
    test('tracks job starts', () => {
      const throttler = new IntervalThrottler({ limit: 3, interval: 1000 });

      expect(throttler.getNextRunDelay()).toBe(0);

      throttler.notifyJobStarted();
      throttler.notifyJobStarted();
      throttler.notifyJobStarted();

      // Should now be throttled
      expect(throttler.getNextRunDelay()).toBeGreaterThan(0);
    });
  });

  describe('reset', () => {
    test('clears all tracked job starts', () => {
      const throttler = new IntervalThrottler({ limit: 2, interval: 1000 });

      throttler.notifyJobStarted();
      throttler.notifyJobStarted();

      // Throttled
      expect(throttler.getNextRunDelay()).toBeGreaterThan(0);

      throttler.reset();

      // Should be able to run again
      expect(throttler.getNextRunDelay()).toBe(0);
    });
  });

  describe('sliding window', () => {
    test('oldest entries expire over time', async () => {
      const throttler = new IntervalThrottler({ limit: 2, interval: 50 });

      throttler.notifyJobStarted();

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 30));

      throttler.notifyJobStarted();

      // Limit reached
      expect(throttler.getNextRunDelay()).toBeGreaterThan(0);

      // Wait for first entry to expire
      await new Promise((resolve) => setTimeout(resolve, 30));

      // Should be able to run again (first entry expired)
      expect(throttler.getNextRunDelay()).toBe(0);
    });
  });

  describe('edge cases', () => {
    test('handles limit of 1', () => {
      const throttler = new IntervalThrottler({ limit: 1, interval: 100 });

      throttler.notifyJobStarted();

      // Should be throttled after just 1 job
      expect(throttler.getNextRunDelay()).toBeGreaterThan(0);
    });

    test('handles large limit', () => {
      const throttler = new IntervalThrottler({ limit: 1000, interval: 1000 });

      for (let i = 0; i < 500; i++) {
        throttler.notifyJobStarted();
      }

      // Still under limit
      expect(throttler.getNextRunDelay()).toBe(0);
    });

    test('handles very short interval', async () => {
      const throttler = new IntervalThrottler({ limit: 1, interval: 10 });

      throttler.notifyJobStarted();
      expect(throttler.getNextRunDelay()).toBeGreaterThan(0);

      await new Promise((resolve) => setTimeout(resolve, 15));

      expect(throttler.getNextRunDelay()).toBe(0);
    });
  });

  describe('properties', () => {
    test('exposes limit', () => {
      const throttler = new IntervalThrottler({ limit: 10, interval: 1000 });
      expect(throttler.limit).toBe(10);
    });

    test('exposes interval', () => {
      const throttler = new IntervalThrottler({ limit: 10, interval: 2000 });
      expect(throttler.interval).toBe(2000);
    });
  });
});
