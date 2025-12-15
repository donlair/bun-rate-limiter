import { describe, expect, test } from 'bun:test';
import { SpacingThrottler } from '../../src/strategies/throttle/SpacingThrottler.ts';

describe('SpacingThrottler', () => {
  describe('getNextRunDelay', () => {
    test('returns 0 initially', () => {
      const throttler = new SpacingThrottler(100);

      expect(throttler.getNextRunDelay()).toBe(0);
    });

    test('returns approximately minDelay after notifyJobStarted', () => {
      const throttler = new SpacingThrottler(100);

      throttler.notifyJobStarted();
      const delay = throttler.getNextRunDelay();

      // Should be close to 100ms (allowing for tiny execution time)
      expect(delay).toBeGreaterThan(95);
      expect(delay).toBeLessThanOrEqual(100);
    });

    test('returns 0 after minDelay has passed', async () => {
      const throttler = new SpacingThrottler(50);

      throttler.notifyJobStarted();

      // Wait for the delay to pass
      await new Promise((resolve) => setTimeout(resolve, 60));

      expect(throttler.getNextRunDelay()).toBe(0);
    });

    test('decreases over time', async () => {
      const throttler = new SpacingThrottler(100);

      throttler.notifyJobStarted();
      const delay1 = throttler.getNextRunDelay();

      await new Promise((resolve) => setTimeout(resolve, 30));
      const delay2 = throttler.getNextRunDelay();

      expect(delay2).toBeLessThan(delay1);
    });
  });

  describe('notifyJobStarted', () => {
    test('updates lastRunTime', () => {
      const throttler = new SpacingThrottler(100);

      // Initially no delay
      expect(throttler.getNextRunDelay()).toBe(0);

      throttler.notifyJobStarted();

      // Now there should be a delay
      expect(throttler.getNextRunDelay()).toBeGreaterThan(0);
    });

    test('resets the delay timer on each call', async () => {
      const throttler = new SpacingThrottler(100);

      throttler.notifyJobStarted();
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Should have about 50ms remaining
      const delayBefore = throttler.getNextRunDelay();
      expect(delayBefore).toBeLessThan(60);
      expect(delayBefore).toBeGreaterThan(40);

      // Notify again - should reset to 100ms
      throttler.notifyJobStarted();
      const delayAfter = throttler.getNextRunDelay();

      expect(delayAfter).toBeGreaterThan(95);
    });
  });

  describe('reset', () => {
    test('clears the lastRunTime', () => {
      const throttler = new SpacingThrottler(100);

      throttler.notifyJobStarted();
      expect(throttler.getNextRunDelay()).toBeGreaterThan(0);

      throttler.reset();
      expect(throttler.getNextRunDelay()).toBe(0);
    });
  });

  describe('minDelay property', () => {
    test('exposes the configured minDelay', () => {
      const throttler = new SpacingThrottler(150);
      expect(throttler.minDelay).toBe(150);
    });
  });

  describe('lastRunTime property', () => {
    test('is 0 initially', () => {
      const throttler = new SpacingThrottler(100);
      expect(throttler.lastRunTime).toBe(0);
    });

    test('is updated after notifyJobStarted', () => {
      const throttler = new SpacingThrottler(100);
      const before = Date.now();

      throttler.notifyJobStarted();

      expect(throttler.lastRunTime).toBeGreaterThanOrEqual(before);
      expect(throttler.lastRunTime).toBeLessThanOrEqual(Date.now());
    });
  });

  describe('edge cases', () => {
    test('handles 0 minDelay', () => {
      const throttler = new SpacingThrottler(0);

      expect(throttler.getNextRunDelay()).toBe(0);
      throttler.notifyJobStarted();
      expect(throttler.getNextRunDelay()).toBe(0);
    });

    test('handles very large minDelay', () => {
      const throttler = new SpacingThrottler(1000000);

      throttler.notifyJobStarted();
      const delay = throttler.getNextRunDelay();

      // Should be very close to the large value
      expect(delay).toBeGreaterThan(999990);
    });
  });
});
