import { describe, expect, mock, test } from 'bun:test';
import { RateLimiter } from '../../src/index.ts';

describe('RateLimiter Integration', () => {
  describe('basic functionality', () => {
    test('creates queue with default options', () => {
      const queue = new RateLimiter();

      expect(queue.size).toBe(0);
      expect(queue.pending).toBe(0);
      expect(queue.isPaused).toBe(false);
    });

    test('add returns promise that resolves with result', async () => {
      const queue = new RateLimiter();

      const result = await queue.add(async () => 'hello');

      expect(result).toBe('hello');
    });

    test('add handles task errors', async () => {
      const queue = new RateLimiter();

      try {
        await queue.add(async () => {
          throw new Error('task failed');
        });
        expect(true).toBe(false); // Should not reach here
      } catch (e) {
        expect((e as Error).message).toBe('task failed');
      }
    });

    test('passes signal to task function', async () => {
      const queue = new RateLimiter();
      let receivedSignal: AbortSignal | undefined;

      await queue.add(async ({ signal }) => {
        receivedSignal = signal;
        return 'done';
      });

      expect(receivedSignal).toBeDefined();
      expect(receivedSignal).toBeInstanceOf(AbortSignal);
    });
  });

  describe('concurrency', () => {
    test('respects concurrency limit', async () => {
      const queue = new RateLimiter({ concurrency: 2 });

      let maxConcurrent = 0;
      let currentConcurrent = 0;

      const createTask = () => async () => {
        currentConcurrent++;
        maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
        await new Promise((resolve) => setTimeout(resolve, 30));
        currentConcurrent--;
        return 'done';
      };

      const promises = [
        queue.add(createTask()),
        queue.add(createTask()),
        queue.add(createTask()),
        queue.add(createTask()),
      ];

      await Promise.all(promises);

      expect(maxConcurrent).toBe(2);
    });

    test('default concurrency is 1', async () => {
      const queue = new RateLimiter();

      let maxConcurrent = 0;
      let currentConcurrent = 0;

      const createTask = () => async () => {
        currentConcurrent++;
        maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
        await new Promise((resolve) => setTimeout(resolve, 20));
        currentConcurrent--;
        return 'done';
      };

      const promises = [queue.add(createTask()), queue.add(createTask()), queue.add(createTask())];

      await Promise.all(promises);

      expect(maxConcurrent).toBe(1);
    });
  });

  describe('burst prevention (limits.minDelayMs)', () => {
    test('enforces minimum delay between task starts', async () => {
      const queue = new RateLimiter({ concurrency: 5, limits: { minDelayMs: 50 } });

      const startTimes: number[] = [];
      const start = Date.now();

      const createTask = () => async () => {
        startTimes.push(Date.now() - start);
        return 'done';
      };

      const promises = [queue.add(createTask()), queue.add(createTask()), queue.add(createTask())];

      await Promise.all(promises);

      // First task should start immediately
      expect(startTimes[0]).toBeLessThan(20);

      // Second task should start ~50ms after first
      expect(startTimes[1]).toBeGreaterThanOrEqual(45);
      expect(startTimes[1]).toBeLessThan(80);

      // Third task should start ~100ms after first
      expect(startTimes[2]).toBeGreaterThanOrEqual(95);
    });

    test('pacing works with high concurrency', async () => {
      const queue = new RateLimiter({ concurrency: 10, limits: { minDelayMs: 30 } });

      const startTimes: number[] = [];
      const start = Date.now();

      // Add 5 tasks
      const promises = Array.from({ length: 5 }, () =>
        queue.add(async () => {
          startTimes.push(Date.now() - start);
          await new Promise((resolve) => setTimeout(resolve, 10));
          return 'done';
        }),
      );

      await Promise.all(promises);

      // Each task should be paced ~30ms apart
      for (let i = 1; i < startTimes.length; i++) {
        // biome-ignore lint/style/noNonNullAssertion: Loop bounds guarantee valid indices
        const gap = startTimes[i]! - startTimes[i - 1]!;
        expect(gap).toBeGreaterThanOrEqual(25);
      }
    });

    test('paces a burst, respects concurrency, and does not start early when a task finishes fast', async () => {
      const queue = new RateLimiter({ concurrency: 5, limits: { minDelayMs: 100 } });

      const start = Date.now();
      const startById: number[] = [];

      let currentConcurrent = 0;
      let maxConcurrent = 0;

      const durationsMs = [600, 50, 600, 600, 600, 600, 600, 600, 600, 600];

      const promises = durationsMs.map((duration, id) =>
        queue.add(async () => {
          startById[id] = Date.now() - start;
          currentConcurrent++;
          maxConcurrent = Math.max(maxConcurrent, currentConcurrent);

          await new Promise((resolve) => setTimeout(resolve, duration));

          currentConcurrent--;
          return id;
        }),
      );

      await Promise.all(promises);

      // Starts are paced ~100ms apart even though concurrency allows parallel execution.
      for (let i = 1; i < startById.length; i++) {
        // biome-ignore lint/style/noNonNullAssertion: Loop bounds guarantee valid indices
        const gap = startById[i]! - startById[i - 1]!;
        expect(gap).toBeGreaterThanOrEqual(90);
      }

      // In particular, task 2 should not start until minDelayMs has elapsed since task 1 started.
      // biome-ignore lint/style/noNonNullAssertion: ids 1 and 2 are always present
      expect(startById[2]! - startById[1]!).toBeGreaterThanOrEqual(90);

      // Concurrency limit is enforced, and we do reach the configured parallelism.
      expect(maxConcurrent).toBeLessThanOrEqual(5);
      expect(maxConcurrent).toBe(5);
    });
  });

  describe('priority', () => {
    test('higher priority tasks run first', async () => {
      const queue = new RateLimiter({ concurrency: 1 });

      const results: string[] = [];

      // Pause to queue up tasks
      queue.pause();

      const p1 = queue.add(
        async () => {
          results.push('low');
          return 'low';
        },
        { priority: 1 },
      );

      const p2 = queue.add(
        async () => {
          results.push('high');
          return 'high';
        },
        { priority: 10 },
      );

      const p3 = queue.add(
        async () => {
          results.push('medium');
          return 'medium';
        },
        { priority: 5 },
      );

      queue.start();

      await Promise.all([p1, p2, p3]);

      expect(results).toEqual(['high', 'medium', 'low']);
    });
  });

  describe('pause and start', () => {
    test('pause stops processing', async () => {
      const queue = new RateLimiter();

      queue.pause();

      let executed = false;
      const promise = queue.add(async () => {
        executed = true;
        return 'done';
      });

      await new Promise((resolve) => setTimeout(resolve, 30));

      expect(executed).toBe(false);
      expect(queue.isPaused).toBe(true);

      queue.start();

      await promise;

      expect(executed).toBe(true);
    });

    test('running tasks complete when paused', async () => {
      const queue = new RateLimiter();

      const promise = queue.add(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return 'done';
      });

      // Wait for task to start
      await new Promise((resolve) => setTimeout(resolve, 10));

      queue.pause();

      // Task should still complete
      const result = await promise;
      expect(result).toBe('done');
    });
  });

  describe('clear', () => {
    test('removes pending tasks', async () => {
      const queue = new RateLimiter({ concurrency: 1 });

      queue.pause();

      queue.add(async () => 1).catch(() => {});
      queue.add(async () => 2).catch(() => {});
      queue.add(async () => 3).catch(() => {});

      expect(queue.size).toBe(3);

      queue.clear();

      expect(queue.size).toBe(0);
    });

    test('rejects pending task promises when cleared', async () => {
      const queue = new RateLimiter({ concurrency: 1 });

      queue.pause();

      const promise = queue.add(async () => 'value');

      queue.clear();

      await expect(promise).rejects.toHaveProperty('name', 'AbortError');
    });
  });

  describe('addAll', () => {
    test('adds multiple tasks and returns all results', async () => {
      const queue = new RateLimiter({ concurrency: 3 });

      const results = await queue.addAll([async () => 1, async () => 2, async () => 3]);

      expect(results).toEqual([1, 2, 3]);
    });

    test('applies same options to all tasks', async () => {
      const queue = new RateLimiter({ concurrency: 1 });

      const results: number[] = [];

      queue.pause();

      const promise = queue.addAll(
        [
          async () => {
            results.push(1);
            return 1;
          },
          async () => {
            results.push(2);
            return 2;
          },
        ],
        { priority: 10 },
      );

      // Add a lower priority task
      queue
        .add(
          async () => {
            results.push(0);
            return 0;
          },
          { priority: 1 },
        )
        .catch(() => {});

      queue.start();

      await promise;
      // Wait for the low priority task
      await new Promise((resolve) => setTimeout(resolve, 20));

      // High priority tasks should run first
      expect(results.slice(0, 2)).toEqual([1, 2]);
    });
  });

  describe('events', () => {
    test('emits idle when queue becomes empty', async () => {
      const queue = new RateLimiter();
      const onIdle = mock(() => {});

      queue.on('idle', onIdle);

      await queue.add(async () => 'done');

      // Wait for idle to be emitted
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(onIdle).toHaveBeenCalled();
    });

    test('emits active when processing starts', async () => {
      const queue = new RateLimiter();
      const onActive = mock(() => {});

      queue.on('active', onActive);

      const promise = queue.add(async () => 'done');

      expect(onActive).toHaveBeenCalled();

      await promise;
    });

    test('emits add when task is added', async () => {
      const queue = new RateLimiter();
      const onAdd = mock(() => {});

      queue.on('add', onAdd);

      const promise = queue.add(async () => 'done');

      expect(onAdd).toHaveBeenCalled();

      await promise;
    });

    test('emits completed when task completes', async () => {
      const queue = new RateLimiter();
      const onCompleted = mock(() => {});

      queue.on('completed', onCompleted);

      await queue.add(async () => 'done');

      expect(onCompleted).toHaveBeenCalledWith('done');
    });

    test('emits error when task fails', async () => {
      const queue = new RateLimiter();
      const onError = mock(() => {});

      queue.on('error', onError);

      try {
        await queue.add(async () => {
          throw new Error('test error');
        });
      } catch {
        // Expected
      }

      // Wait a tick for event to be emitted
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(onError).toHaveBeenCalled();
    });
  });

  describe('size and pending', () => {
    test('size includes all queued tasks', async () => {
      const queue = new RateLimiter({ concurrency: 1 });

      queue.pause();

      queue.add(async () => 1).catch(() => {});
      queue.add(async () => 2).catch(() => {});

      expect(queue.size).toBe(2);
      expect(queue.pending).toBe(0); // pending = running count (p-queue convention)
      expect(queue.runningCount).toBe(0);

      queue.start();
    });

    test('pending reflects running tasks (p-queue convention)', async () => {
      const queue = new RateLimiter({ concurrency: 2 });

      const p1 = queue.add(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return 1;
      });

      const p2 = queue.add(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return 2;
      });

      queue.add(async () => 3).catch(() => {});

      // Wait for first two tasks to start
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Two running, one in queue
      expect(queue.pending).toBe(2); // running count
      expect(queue.runningCount).toBe(2); // same as pending
      expect(queue.size).toBe(1); // queued count

      await Promise.all([p1, p2]);
    });
  });

  describe('smoke test', () => {
    test('handles 10 tasks with pacing', async () => {
      const queue = new RateLimiter({ concurrency: 5, limits: { minDelayMs: 50 } });

      const start = Date.now();

      const results = await queue.addAll(Array.from({ length: 10 }, (_, i) => async () => i));

      const elapsed = Date.now() - start;

      // With 10 tasks and 50ms pacing, should take at least 450ms
      // (first task at 0ms, then 9 more tasks at 50ms intervals)
      expect(elapsed).toBeGreaterThanOrEqual(400);

      // Results should be in order
      expect(results).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    });
  });

  describe('isRateLimited and isSaturated', () => {
    test('isRateLimited is false when no minDelayMs configured', () => {
      const queue = new RateLimiter({ concurrency: 5 });

      expect(queue.isRateLimited).toBe(false);
    });

    test('isRateLimited is false initially with minDelayMs (no jobs run yet)', () => {
      const queue = new RateLimiter({ concurrency: 5, limits: { minDelayMs: 100 } });

      // Before any job starts, SpacingThrottler reports 0 delay
      expect(queue.isRateLimited).toBe(false);
    });

    test('isRateLimited is true after task starts with minDelayMs', async () => {
      const queue = new RateLimiter({ concurrency: 5, limits: { minDelayMs: 100 } });

      // Run a quick task to trigger throttler
      await queue.add(async () => 'done');

      // Right after task completes, throttler should still enforce delay
      expect(queue.isRateLimited).toBe(true);
    });

    test('isRateLimited becomes false after delay elapses', async () => {
      const queue = new RateLimiter({ concurrency: 5, limits: { minDelayMs: 30 } });

      await queue.add(async () => 'done');

      // Should be rate limited immediately after
      expect(queue.isRateLimited).toBe(true);

      // Wait for delay to elapse
      await new Promise((resolve) => setTimeout(resolve, 40));

      expect(queue.isRateLimited).toBe(false);
    });

    test('isSaturated is false when idle', () => {
      const queue = new RateLimiter({ concurrency: 2 });

      expect(queue.isSaturated).toBe(false);
      expect(queue.pending).toBe(0);
    });

    test('isSaturated is true when at concurrency limit', async () => {
      const queue = new RateLimiter({ concurrency: 2 });

      // Start 2 long-running tasks
      const p1 = queue.add(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return 1;
      });
      const p2 = queue.add(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return 2;
      });

      // Wait for tasks to start
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(queue.pending).toBe(2);
      expect(queue.isSaturated).toBe(true);

      await Promise.all([p1, p2]);
    });

    test('isSaturated is true when rate limited (even with slots available)', async () => {
      const queue = new RateLimiter({ concurrency: 10, limits: { minDelayMs: 100 } });

      // Run a quick task
      await queue.add(async () => 'done');

      // Wait for job completion callback to decrement runningCount
      await new Promise((resolve) => setTimeout(resolve, 10));

      // No tasks running now, but rate limited
      expect(queue.pending).toBe(0);
      expect(queue.isRateLimited).toBe(true);
      expect(queue.isSaturated).toBe(true);
    });

    test('isSaturated reflects both concurrency and rate limit', async () => {
      const queue = new RateLimiter({ concurrency: 1, limits: { minDelayMs: 50 } });

      // Start a longer task
      const p1 = queue.add(async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        return 1;
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Both at capacity and rate limited
      expect(queue.pending).toBe(1);
      expect(queue.isRateLimited).toBe(true);
      expect(queue.isSaturated).toBe(true);

      await p1;
    });

    test('isSaturated becomes false when job completes and not rate limited', async () => {
      const queue = new RateLimiter({ concurrency: 1 }); // No minDelayMs

      const p = queue.add(async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        return 'done';
      });

      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(queue.isSaturated).toBe(true);

      await p;
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(queue.pending).toBe(0);
      expect(queue.isSaturated).toBe(false);
    });
  });
});
