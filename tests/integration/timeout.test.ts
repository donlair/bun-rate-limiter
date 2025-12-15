import { describe, expect, test } from 'bun:test';
import { RateLimiter, TimeoutError } from '../../src/index.ts';

describe('RateLimiter Timeout Integration', () => {
  describe('per-task timeout', () => {
    test('task completes before timeout', async () => {
      const queue = new RateLimiter({ concurrency: 1 });

      const result = await queue.add(
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return 'done';
        },
        { timeout: 100 },
      );

      expect(result).toBe('done');
    });

    test('task exceeds timeout - rejects with TimeoutError', async () => {
      const queue = new RateLimiter({ concurrency: 1 });

      await expect(
        queue.add(
          async () => {
            await new Promise((resolve) => setTimeout(resolve, 200));
            return 'done';
          },
          { timeout: 50 },
        ),
      ).rejects.toBeInstanceOf(TimeoutError);
    });

    test('per-task timeout overrides default timeout', async () => {
      const queue = new RateLimiter({ concurrency: 1, timeout: 10 });

      // This would fail with default timeout of 10ms, but task-specific 200ms allows it
      const result = await queue.add(
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 50));
          return 'done';
        },
        { timeout: 200 },
      );

      expect(result).toBe('done');
    });
  });

  describe('default timeout', () => {
    test('applies default timeout to all tasks', async () => {
      const queue = new RateLimiter({ concurrency: 1, timeout: 50 });

      await expect(
        queue.add(async () => {
          await new Promise((resolve) => setTimeout(resolve, 200));
          return 'done';
        }),
      ).rejects.toBeInstanceOf(TimeoutError);
    });

    test('tasks without timeout when no default set', async () => {
      const queue = new RateLimiter({ concurrency: 1 });

      const result = await queue.add(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return 'done';
      });

      expect(result).toBe('done');
    });
  });

  describe('timeout with concurrency', () => {
    test('timeout affects individual tasks not entire queue', async () => {
      const queue = new RateLimiter({ concurrency: 2 });

      const results: string[] = [];

      const p1 = queue
        .add(
          async () => {
            await new Promise((resolve) => setTimeout(resolve, 200));
            return 'slow';
          },
          { timeout: 50 },
        )
        .catch(() => {
          results.push('timeout');
          return 'timeout';
        });

      const p2 = queue.add(async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        results.push('fast');
        return 'fast';
      });

      await Promise.all([p1, p2]);

      // Fast task completes, slow task times out
      expect(results).toContain('fast');
      expect(results).toContain('timeout');
    });

    test('multiple tasks with different timeouts', async () => {
      const queue = new RateLimiter({ concurrency: 3 });

      const results: Array<{ id: number; status: string }> = [];

      const tasks = [
        // Task 1: 100ms work, 50ms timeout -> times out
        queue
          .add(
            async () => {
              await new Promise((resolve) => setTimeout(resolve, 100));
              return 1;
            },
            { timeout: 50 },
          )
          .then(() => results.push({ id: 1, status: 'completed' }))
          .catch(() => results.push({ id: 1, status: 'timeout' })),

        // Task 2: 30ms work, 100ms timeout -> completes
        queue
          .add(
            async () => {
              await new Promise((resolve) => setTimeout(resolve, 30));
              return 2;
            },
            { timeout: 100 },
          )
          .then(() => results.push({ id: 2, status: 'completed' }))
          .catch(() => results.push({ id: 2, status: 'timeout' })),

        // Task 3: 50ms work, no timeout -> completes
        queue
          .add(async () => {
            await new Promise((resolve) => setTimeout(resolve, 50));
            return 3;
          })
          .then(() => results.push({ id: 3, status: 'completed' }))
          .catch(() => results.push({ id: 3, status: 'timeout' })),
      ];

      await Promise.all(tasks);

      expect(results.find((r) => r.id === 1)?.status).toBe('timeout');
      expect(results.find((r) => r.id === 2)?.status).toBe('completed');
      expect(results.find((r) => r.id === 3)?.status).toBe('completed');
    });
  });

  describe('timeout with rate limiting', () => {
    test('timeout starts when task executes not when queued', async () => {
      const queue = new RateLimiter({
        concurrency: 1,
        requestDelay: 100, // 100ms between task starts
      });

      // First task: takes 50ms
      const p1 = queue.add(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return 'first';
      });

      // Second task: queued immediately, but won't start for ~100ms
      // Has 80ms timeout which is enough for the 30ms work
      const p2 = queue.add(
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 30));
          return 'second';
        },
        { timeout: 80 },
      );

      const results = await Promise.all([p1, p2]);

      // Both should complete - timeout is from execution start, not queue time
      expect(results[0]).toBe('first');
      expect(results[1]).toBe('second');
    });
  });

  describe('timeout events', () => {
    test('emits error event on timeout', async () => {
      const queue = new RateLimiter({ concurrency: 1 });

      let errorEmitted: Error | null = null;
      queue.on('error', (error) => {
        errorEmitted = error;
      });

      await queue
        .add(
          async () => {
            await new Promise((resolve) => setTimeout(resolve, 200));
            return 'done';
          },
          { timeout: 50 },
        )
        .catch(() => {});

      // Wait a tick for event to propagate
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(errorEmitted).toBeInstanceOf(TimeoutError);
    });
  });

  describe('timeout with AbortSignal', () => {
    test('external abort before timeout', async () => {
      const queue = new RateLimiter({ concurrency: 1 });
      const controller = new AbortController();

      const promise = queue.add(
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 200));
          return 'done';
        },
        { timeout: 100, signal: controller.signal },
      );

      // Abort externally at 30ms (before 100ms timeout)
      setTimeout(() => controller.abort(), 30);

      try {
        await promise;
        expect(true).toBe(false); // Should not reach
      } catch (e) {
        // Should be AbortError, not TimeoutError
        expect((e as DOMException).name).toBe('AbortError');
      }
    });

    test('timeout before external abort', async () => {
      const queue = new RateLimiter({ concurrency: 1 });
      const controller = new AbortController();

      const promise = queue.add(
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 200));
          return 'done';
        },
        { timeout: 30, signal: controller.signal },
      );

      // Abort externally at 100ms (after 30ms timeout)
      setTimeout(() => controller.abort(), 100);

      await expect(promise).rejects.toBeInstanceOf(TimeoutError);
    });
  });
});
