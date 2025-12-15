import { describe, expect, mock, test } from 'bun:test';
import { Job } from '../../src/core/Job.ts';
import { StandardScheduler } from '../../src/scheduler/StandardScheduler.ts';
import { ArrayQueue } from '../../src/strategies/queue/ArrayQueue.ts';
import type { IAsyncThrottler } from '../../src/strategies/throttle/IAsyncThrottler.ts';
import type { IThrottler } from '../../src/strategies/throttle/IThrottler.ts';
import { SpacingThrottler } from '../../src/strategies/throttle/SpacingThrottler.ts';

// Helper to create a mock throttler
function createMockThrottler(delay = 0): IThrottler {
  return {
    getNextRunDelay: mock(() => delay),
    notifyJobStarted: mock(() => {}),
    reset: mock(() => {}),
  };
}

describe('StandardScheduler', () => {
  describe('construction', () => {
    test('creates scheduler with default concurrency of 1', () => {
      const queue = new ArrayQueue<Job<unknown>>();
      const scheduler = new StandardScheduler(queue, []);

      expect(scheduler.concurrency).toBe(1);
    });

    test('creates scheduler with custom concurrency', () => {
      const queue = new ArrayQueue<Job<unknown>>();
      const scheduler = new StandardScheduler(queue, [], { concurrency: 5 });

      expect(scheduler.concurrency).toBe(5);
    });

    test('starts paused by default', () => {
      const queue = new ArrayQueue<Job<unknown>>();
      const scheduler = new StandardScheduler(queue, []);

      expect(scheduler.isPaused).toBe(true);
    });

    test('can auto-start', () => {
      const queue = new ArrayQueue<Job<unknown>>();
      const scheduler = new StandardScheduler(queue, [], { autoStart: true });

      expect(scheduler.isPaused).toBe(false);
    });
  });

  describe('add', () => {
    test('adds job to queue', () => {
      const queue = new ArrayQueue<Job<unknown>>();
      const scheduler = new StandardScheduler(queue, []);
      const job = new Job(async () => 'result');

      scheduler.add(job);

      expect(scheduler.pendingCount).toBe(1);
    });

    test('triggers tryNext when auto-started', async () => {
      const queue = new ArrayQueue<Job<unknown>>();
      const throttler = createMockThrottler(0);
      const scheduler = new StandardScheduler(queue, [throttler], { autoStart: true });

      const job = new Job(async () => 'result');
      scheduler.add(job);

      // Wait for job to complete
      await job.promise;

      expect(job.status).toBe('completed');
      expect(throttler.notifyJobStarted).toHaveBeenCalled();
    });
  });

  describe('concurrency', () => {
    test('respects concurrency limit', async () => {
      const queue = new ArrayQueue<Job<unknown>>();
      const scheduler = new StandardScheduler(queue, [], {
        concurrency: 2,
        autoStart: true,
      });

      let runningCount = 0;
      let maxRunning = 0;

      const createTrackingJob = () =>
        new Job(async () => {
          runningCount++;
          maxRunning = Math.max(maxRunning, runningCount);
          await new Promise((resolve) => setTimeout(resolve, 50));
          runningCount--;
          return 'done';
        });

      const jobs = [
        createTrackingJob(),
        createTrackingJob(),
        createTrackingJob(),
        createTrackingJob(),
      ];

      jobs.forEach((job) => {
        job.promise.catch(() => {}); // Prevent unhandled rejection
        scheduler.add(job);
      });

      // Wait for all jobs to complete
      await Promise.all(jobs.map((j) => j.promise));

      expect(maxRunning).toBe(2);
    });

    test('only 2 jobs run at a time with concurrency 2', async () => {
      const queue = new ArrayQueue<Job<unknown>>();
      const scheduler = new StandardScheduler(queue, [], {
        concurrency: 2,
        autoStart: true,
      });

      const runOrder: number[] = [];
      const startTimes: number[] = [];
      const start = Date.now();

      const createTrackedJob = (id: number) =>
        new Job(async () => {
          startTimes.push(Date.now() - start);
          runOrder.push(id);
          await new Promise((resolve) => setTimeout(resolve, 50));
          return id;
        });

      const jobs = [
        createTrackedJob(1),
        createTrackedJob(2),
        createTrackedJob(3),
        createTrackedJob(4),
      ];

      for (const job of jobs) {
        scheduler.add(job);
      }

      await Promise.all(jobs.map((j) => j.promise));

      // First two should start almost immediately
      expect(startTimes[0]).toBeLessThan(20);
      expect(startTimes[1]).toBeLessThan(20);

      // Next two should start after ~50ms
      expect(startTimes[2]).toBeGreaterThan(40);
      expect(startTimes[3]).toBeGreaterThan(40);
    });
  });

  describe('throttling', () => {
    test('consults throttlers before running jobs', async () => {
      const queue = new ArrayQueue<Job<unknown>>();
      const throttler = createMockThrottler(0);
      const scheduler = new StandardScheduler(queue, [throttler], { autoStart: true });

      const job = new Job(async () => 'result');
      scheduler.add(job);

      await job.promise;

      expect(throttler.getNextRunDelay).toHaveBeenCalled();
    });

    test('notifies throttlers when job starts', async () => {
      const queue = new ArrayQueue<Job<unknown>>();
      const throttler = createMockThrottler(0);
      const scheduler = new StandardScheduler(queue, [throttler], { autoStart: true });

      const job = new Job(async () => 'result');
      scheduler.add(job);

      await job.promise;

      expect(throttler.notifyJobStarted).toHaveBeenCalled();
    });

    test('waits when throttler returns delay', async () => {
      const queue = new ArrayQueue<Job<unknown>>();
      let callCount = 0;
      const throttler: IThrottler = {
        getNextRunDelay: () => {
          callCount++;
          // Return delay first time, 0 second time
          return callCount === 1 ? 30 : 0;
        },
        notifyJobStarted: () => {},
        reset: () => {},
      };

      const scheduler = new StandardScheduler(queue, [throttler], { autoStart: true });

      const start = Date.now();
      const job = new Job(async () => 'result');
      scheduler.add(job);

      await job.promise;

      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(25);
    });

    test('uses maximum delay from multiple throttlers', async () => {
      const queue = new ArrayQueue<Job<unknown>>();
      let call1 = 0;
      let call2 = 0;

      const throttler1: IThrottler = {
        getNextRunDelay: () => {
          call1++;
          return call1 === 1 ? 20 : 0;
        },
        notifyJobStarted: () => {},
        reset: () => {},
      };

      const throttler2: IThrottler = {
        getNextRunDelay: () => {
          call2++;
          return call2 === 1 ? 40 : 0;
        },
        notifyJobStarted: () => {},
        reset: () => {},
      };

      const scheduler = new StandardScheduler(queue, [throttler1, throttler2], {
        autoStart: true,
      });

      const start = Date.now();
      const job = new Job(async () => 'result');
      scheduler.add(job);

      await job.promise;

      const elapsed = Date.now() - start;
      // Should wait for the longer delay (40ms)
      expect(elapsed).toBeGreaterThanOrEqual(35);
    });
  });

  describe('async throttling', () => {
    test('waits when async throttler returns delay', async () => {
      const queue = new ArrayQueue<Job<unknown>>();
      let callCount = 0;

      const asyncThrottler: IAsyncThrottler = {
        acquire: async () => {
          callCount++;
          return callCount === 1 ? { granted: false, delayMs: 30 } : { granted: true };
        },
      };

      const scheduler = new StandardScheduler(queue, [], {
        autoStart: true,
        asyncThrottlers: [asyncThrottler],
      });

      const start = Date.now();
      const job = new Job(async () => 'result');
      scheduler.add(job);

      await job.promise;

      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(25);
    });

    test('passes per-task rateLimitKey into async acquire context', async () => {
      const queue = new ArrayQueue<Job<unknown>>();
      let seenKey: string | undefined;
      let seenJobKey: string | undefined;

      const asyncThrottler: IAsyncThrottler = {
        acquire: async ({ key, job }) => {
          seenKey = key;
          seenJobKey = job.rateLimitKey;
          return { granted: true };
        },
      };

      const scheduler = new StandardScheduler(queue, [], {
        autoStart: true,
        asyncThrottlers: [asyncThrottler],
      });
      const job = new Job(async () => 'result', { rateLimitKey: 'user:123' });
      scheduler.add(job);

      await job.promise;

      expect(seenKey).toBe('user:123');
      expect(seenJobKey).toBe('user:123');
    });

    test('releases acquired permits when any async throttler blocks', async () => {
      const queue = new ArrayQueue<Job<unknown>>();

      const release = mock(async () => {});

      const granting: IAsyncThrottler = {
        acquire: async () => ({ granted: true, permit: { release } }),
      };

      let denyCalls = 0;
      const denyingThenGranting: IAsyncThrottler = {
        acquire: async () => {
          denyCalls++;
          return denyCalls === 1 ? { granted: false, delayMs: 20 } : { granted: true };
        },
      };

      const scheduler = new StandardScheduler(queue, [], {
        autoStart: true,
        asyncThrottlers: [granting, denyingThenGranting],
      });

      const job = new Job(async () => 'result');
      scheduler.add(job);
      await job.promise;

      expect(release).toHaveBeenCalledTimes(1);
    });

    test('skips cancelled jobs without calling async throttlers', async () => {
      const queue = new ArrayQueue<Job<unknown>>();
      const acquire = mock(async () => ({ granted: true }) as const);
      const asyncThrottler: IAsyncThrottler = { acquire };

      const scheduler = new StandardScheduler(queue, [], {
        autoStart: true,
        asyncThrottlers: [asyncThrottler],
      });

      const job = new Job(async () => 'result');
      job.cancel();
      scheduler.add(job);

      await expect(job.promise).rejects.toHaveProperty('name', 'AbortError');

      expect(acquire).not.toHaveBeenCalled();
    });

    test('resetAsyncThrottlers clears delays and calls reset()', async () => {
      const queue = new ArrayQueue<Job<unknown>>();

      let allow = false;
      const reset = mock(async () => {
        allow = true;
      });

      const acquire = mock(async () => {
        return allow
          ? ({ granted: true } as const)
          : ({ granted: false, delayMs: 10_000 } as const);
      });

      const asyncThrottler: IAsyncThrottler = { acquire, reset };

      const scheduler = new StandardScheduler(queue, [], {
        autoStart: true,
        asyncThrottlers: [asyncThrottler],
      });

      const start = Date.now();
      const job = new Job(async () => 'result');
      scheduler.add(job);

      // Wait until we know an async acquire attempt happened and the long delay timer was scheduled.
      while (acquire.mock.calls.length === 0) {
        await new Promise((resolve) => setTimeout(resolve, 1));
      }

      await scheduler.resetAsyncThrottlers();
      await job.promise;

      expect(reset).toHaveBeenCalledTimes(1);
      expect(Date.now() - start).toBeLessThan(500);
    });
  });

  describe('pause and start', () => {
    test('pause stops processing new jobs', async () => {
      const queue = new ArrayQueue<Job<unknown>>();
      const scheduler = new StandardScheduler(queue, [], { autoStart: true });

      scheduler.pause();

      const job = new Job(async () => 'result');
      scheduler.add(job);

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 30));

      expect(job.status).toBe('pending');
      expect(scheduler.isPaused).toBe(true);
    });

    test('start resumes processing', async () => {
      const queue = new ArrayQueue<Job<unknown>>();
      const scheduler = new StandardScheduler(queue, []);

      const job = new Job(async () => 'result');
      scheduler.add(job);

      expect(job.status).toBe('pending');

      scheduler.start();

      await job.promise;

      expect(job.status).toBe('completed');
    });

    test('running jobs complete even when paused', async () => {
      const queue = new ArrayQueue<Job<unknown>>();
      const scheduler = new StandardScheduler(queue, [], { autoStart: true });

      const job = new Job(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return 'result';
      });

      scheduler.add(job);

      // Wait for job to start
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(job.status).toBe('running');

      scheduler.pause();

      // Job should still complete
      await job.promise;
      expect(job.status).toBe('completed');
    });
  });

  describe('clear', () => {
    test('removes pending jobs', () => {
      const queue = new ArrayQueue<Job<unknown>>();
      const scheduler = new StandardScheduler(queue, []);

      const job1 = new Job(async () => 1);
      const job2 = new Job(async () => 2);
      const job3 = new Job(async () => 3);

      scheduler.add(job1);
      scheduler.add(job2);
      scheduler.add(job3);

      job1.promise.catch(() => {});
      job2.promise.catch(() => {});
      job3.promise.catch(() => {});

      expect(scheduler.pendingCount).toBe(3);

      scheduler.clear();

      expect(scheduler.pendingCount).toBe(0);
    });

    test('does not affect running jobs', async () => {
      const queue = new ArrayQueue<Job<unknown>>();
      const scheduler = new StandardScheduler(queue, [], {
        concurrency: 1,
        autoStart: true,
      });

      const runningJob = new Job(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return 'running';
      });

      const pendingJob = new Job(async () => 'pending');

      scheduler.add(runningJob);
      scheduler.add(pendingJob);
      pendingJob.promise.catch(() => {});

      // Wait for first job to start
      await new Promise((resolve) => setTimeout(resolve, 10));

      scheduler.clear();

      expect(scheduler.pendingCount).toBe(0);
      expect(scheduler.runningCount).toBe(1);

      // Running job should still complete
      await runningJob.promise;
      expect(runningJob.status).toBe('completed');
    });

    test('rejects pending job promises when cleared', async () => {
      const queue = new ArrayQueue<Job<unknown>>();
      const scheduler = new StandardScheduler(queue, []);

      const job = new Job(async () => 'result');
      scheduler.add(job);

      scheduler.clear();

      await expect(job.promise).rejects.toBeInstanceOf(DOMException);
      expect(job.status).toBe('cancelled');
      expect(scheduler.pendingCount).toBe(0);
    });
  });

  describe('events', () => {
    test('calls onIdle when queue becomes empty', async () => {
      const queue = new ArrayQueue<Job<unknown>>();
      const scheduler = new StandardScheduler(queue, [], { autoStart: true });
      const onIdle = mock(() => {});

      scheduler.onIdle(onIdle);

      const job = new Job(async () => 'result');
      scheduler.add(job);

      await job.promise;

      // Wait a tick for the idle callback
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(onIdle).toHaveBeenCalled();
    });

    test('calls onActive when first job is added', () => {
      const queue = new ArrayQueue<Job<unknown>>();
      const scheduler = new StandardScheduler(queue, [], { autoStart: true });
      const onActive = mock(() => {});

      scheduler.onActive(onActive);

      const job = new Job(async () => 'result');
      job.promise.catch(() => {});
      scheduler.add(job);

      expect(onActive).toHaveBeenCalled();
    });

    test('unsubscribe prevents callbacks from firing', async () => {
      const queue = new ArrayQueue<Job<unknown>>();
      const scheduler = new StandardScheduler(queue, [], { autoStart: true });
      const onIdle = mock(() => {});
      const onActive = mock(() => {});

      const offIdle = scheduler.onIdle(onIdle);
      const offActive = scheduler.onActive(onActive);

      offIdle();
      offActive();

      const job = new Job(async () => 'result');
      scheduler.add(job);

      await job.promise;
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(onActive).not.toHaveBeenCalled();
      expect(onIdle).not.toHaveBeenCalled();
    });
  });

  describe('runningCount and pendingCount', () => {
    test('tracks running jobs correctly', async () => {
      const queue = new ArrayQueue<Job<unknown>>();
      const scheduler = new StandardScheduler(queue, [], {
        concurrency: 2,
        autoStart: true,
      });

      expect(scheduler.runningCount).toBe(0);

      const job1 = new Job(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return 1;
      });
      const job2 = new Job(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return 2;
      });

      scheduler.add(job1);
      scheduler.add(job2);

      // Wait for jobs to start
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(scheduler.runningCount).toBe(2);
      expect(scheduler.pendingCount).toBe(0);

      await Promise.all([job1.promise, job2.promise]);

      // Wait a tick for cleanup
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(scheduler.runningCount).toBe(0);
    });
  });

  describe('isRateLimited', () => {
    test('is false when no throttlers configured', () => {
      const queue = new ArrayQueue<Job<unknown>>();
      const scheduler = new StandardScheduler(queue, [], { autoStart: true });

      expect(scheduler.isRateLimited).toBe(false);
    });

    test('is false when throttler allows immediate execution (no jobs started yet)', () => {
      const queue = new ArrayQueue<Job<unknown>>();
      const throttler = new SpacingThrottler(100);
      const scheduler = new StandardScheduler(queue, [throttler], { autoStart: true });

      // SpacingThrottler returns 0 delay when no job has started yet
      expect(scheduler.isRateLimited).toBe(false);
    });

    test('is true when throttler requires delay after job starts', async () => {
      const queue = new ArrayQueue<Job<unknown>>();
      const throttler = new SpacingThrottler(100); // 100ms minimum between jobs
      const scheduler = new StandardScheduler(queue, [throttler], {
        concurrency: 5, // High concurrency so rate limiting is the constraint
        autoStart: true,
      });

      // Start a quick job to trigger the throttler
      const job = new Job(async () => 'done');
      scheduler.add(job);
      await job.promise;

      // Right after job completes, throttler should report a delay
      // because less than 100ms has elapsed since job started
      expect(scheduler.isRateLimited).toBe(true);
    });

    test('becomes false after delay period elapses', async () => {
      const queue = new ArrayQueue<Job<unknown>>();
      const throttler = new SpacingThrottler(30); // 30ms spacing
      const scheduler = new StandardScheduler(queue, [throttler], {
        concurrency: 5,
        autoStart: true,
      });

      // Start a quick job
      const job = new Job(async () => 'done');
      scheduler.add(job);
      await job.promise;

      // Should be rate limited immediately after
      expect(scheduler.isRateLimited).toBe(true);

      // Wait for the delay period to elapse
      await new Promise((resolve) => setTimeout(resolve, 40));

      // Now should no longer be rate limited
      expect(scheduler.isRateLimited).toBe(false);
    });

    test('correctly reports rate limited with mock throttler returning specific delay', () => {
      const queue = new ArrayQueue<Job<unknown>>();

      // Mock throttler that always reports a delay
      const alwaysDelayThrottler: IThrottler = {
        getNextRunDelay: () => 50,
        notifyJobStarted: () => {},
        reset: () => {},
      };

      const scheduler = new StandardScheduler(queue, [alwaysDelayThrottler], { autoStart: true });

      // Should be rate limited because throttler reports delay > 0
      expect(scheduler.isRateLimited).toBe(true);
    });

    test('is false when mock throttler returns zero delay', () => {
      const queue = new ArrayQueue<Job<unknown>>();

      // Mock throttler that never reports delay
      const noDelayThrottler: IThrottler = {
        getNextRunDelay: () => 0,
        notifyJobStarted: () => {},
        reset: () => {},
      };

      const scheduler = new StandardScheduler(queue, [noDelayThrottler], { autoStart: true });

      expect(scheduler.isRateLimited).toBe(false);
    });
  });

  describe('isSaturated', () => {
    test('is false when no jobs running and no rate limiting', () => {
      const queue = new ArrayQueue<Job<unknown>>();
      const scheduler = new StandardScheduler(queue, [], {
        concurrency: 2,
        autoStart: true,
      });

      expect(scheduler.isSaturated).toBe(false);
      expect(scheduler.runningCount).toBe(0);
    });

    test('is false when running < concurrency and no rate limiting', async () => {
      const queue = new ArrayQueue<Job<unknown>>();
      const scheduler = new StandardScheduler(queue, [], {
        concurrency: 3,
        autoStart: true,
      });

      // Start 1 long-running job (less than concurrency of 3)
      const job = new Job(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return 'done';
      });
      scheduler.add(job);

      // Wait for job to start
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(scheduler.runningCount).toBe(1);
      expect(scheduler.isSaturated).toBe(false); // 1 < 3, not saturated

      // Clean up
      await job.promise;
    });

    test('is true when running == concurrency', async () => {
      const queue = new ArrayQueue<Job<unknown>>();
      const scheduler = new StandardScheduler(queue, [], {
        concurrency: 2,
        autoStart: true,
      });

      // Start 2 long-running jobs to fill concurrency
      const job1 = new Job(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return 1;
      });
      const job2 = new Job(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return 2;
      });

      scheduler.add(job1);
      scheduler.add(job2);

      // Wait for jobs to start
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(scheduler.runningCount).toBe(2);
      expect(scheduler.isSaturated).toBe(true); // 2 == 2, saturated

      // Clean up
      await Promise.all([job1.promise, job2.promise]);
    });

    test('becomes false when job completes and slots open up', async () => {
      const queue = new ArrayQueue<Job<unknown>>();
      const scheduler = new StandardScheduler(queue, [], {
        concurrency: 1,
        autoStart: true,
      });

      const job = new Job(async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        return 'done';
      });
      scheduler.add(job);

      // Wait for job to start
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(scheduler.runningCount).toBe(1);
      expect(scheduler.isSaturated).toBe(true);

      // Wait for job to complete
      await job.promise;
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(scheduler.runningCount).toBe(0);
      expect(scheduler.isSaturated).toBe(false);
    });

    test('is true when rate limited even with concurrency slots available', async () => {
      const queue = new ArrayQueue<Job<unknown>>();
      const throttler = new SpacingThrottler(100); // 100ms spacing
      const scheduler = new StandardScheduler(queue, [throttler], {
        concurrency: 5, // Plenty of concurrency slots
        autoStart: true,
      });

      // Run a quick job to trigger throttler
      const job = new Job(async () => 'done');
      scheduler.add(job);
      await job.promise;

      // Wait for job completion callback to decrement runningCount
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Now: runningCount=0, but throttler requires delay
      // Should be saturated due to rate limiting
      expect(scheduler.runningCount).toBe(0);
      expect(scheduler.isRateLimited).toBe(true);
      expect(scheduler.isSaturated).toBe(true);
    });

    test('is true when both at concurrency limit and rate limited', async () => {
      const queue = new ArrayQueue<Job<unknown>>();
      const throttler = new SpacingThrottler(100);
      const scheduler = new StandardScheduler(queue, [throttler], {
        concurrency: 1,
        autoStart: true,
      });

      // Start a long-running job
      const job = new Job(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return 'done';
      });
      scheduler.add(job);

      // Wait for job to start
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Both conditions are true: at concurrency AND rate limited
      expect(scheduler.runningCount).toBe(1);
      expect(scheduler.isRateLimited).toBe(true);
      expect(scheduler.isSaturated).toBe(true);

      await job.promise;
    });

    test('isSaturated reflects only concurrency when no throttlers', async () => {
      const queue = new ArrayQueue<Job<unknown>>();
      const scheduler = new StandardScheduler(queue, [], {
        concurrency: 2,
        autoStart: true,
      });

      // Initially not saturated
      expect(scheduler.isSaturated).toBe(false);
      expect(scheduler.isRateLimited).toBe(false);

      // Add 2 jobs to fill slots
      const job1 = new Job(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return 1;
      });
      const job2 = new Job(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return 2;
      });

      scheduler.add(job1);
      scheduler.add(job2);

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Now saturated, but NOT because of rate limiting
      expect(scheduler.isSaturated).toBe(true);
      expect(scheduler.isRateLimited).toBe(false);
      expect(scheduler.runningCount).toBe(2);

      await Promise.all([job1.promise, job2.promise]);
    });
  });
});
