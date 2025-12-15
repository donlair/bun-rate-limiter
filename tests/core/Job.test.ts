import { describe, expect, test } from 'bun:test';
import { TimeoutError } from '../../src/core/errors.ts';
import { Job } from '../../src/core/Job.ts';

describe('Job', () => {
  describe('construction', () => {
    test('creates a job with unique id', () => {
      const job1 = new Job(async () => 'result');
      const job2 = new Job(async () => 'result');

      expect(job1.id).toBeTruthy();
      expect(job2.id).toBeTruthy();
      expect(job1.id).not.toBe(job2.id);
    });

    test('creates a job with default priority of 0', () => {
      const job = new Job(async () => 'result');
      expect(job.priority).toBe(0);
    });

    test('creates a job with custom priority', () => {
      const job = new Job(async () => 'result', { priority: 5 });
      expect(job.priority).toBe(5);
    });

    test('creates a job with initial status of pending', () => {
      const job = new Job(async () => 'result');
      expect(job.status).toBe('pending');
    });
  });

  describe('execute', () => {
    test('executes successfully and resolves promise', async () => {
      const job = new Job(async () => 'success');
      const result = await job.execute();

      expect(result).toBe('success');
      expect(job.status).toBe('completed');
    });

    test('handles errors and rejects promise', async () => {
      const job = new Job(async () => {
        throw new Error('Task failed');
      });

      // Prevent unhandled promise rejection from job.promise
      job.promise.catch(() => {});

      try {
        await job.execute();
        expect(true).toBe(false); // Should not reach here
      } catch (e) {
        expect((e as Error).message).toBe('Task failed');
      }
      expect(job.status).toBe('failed');
    });

    test('sets status to running during execution', async () => {
      let statusDuringExecution: string | undefined;

      const job = new Job(async () => {
        statusDuringExecution = job.status;
        return 'done';
      });

      await job.execute();
      expect(statusDuringExecution).toBe('running');
    });

    test('passes signal to task function', async () => {
      let receivedSignal: AbortSignal | undefined;

      const job = new Job(async ({ signal }) => {
        receivedSignal = signal;
        return 'done';
      });

      await job.execute();
      expect(receivedSignal).toBeInstanceOf(AbortSignal);
    });
  });

  describe('cancellation', () => {
    test('can be cancelled before execution', async () => {
      const job = new Job(async () => 'result');
      const promise = job.promise.catch(() => {});
      job.cancel();

      expect(job.status).toBe('cancelled');
      await expect(job.promise).rejects.toHaveProperty('name', 'AbortError');
      await promise;
    });

    test('cancelled job rejects with AbortError on execute', async () => {
      const job = new Job(async () => 'result');

      // Prevent unhandled promise rejection from job.promise
      job.promise.catch(() => {});

      job.cancel();

      try {
        await job.execute();
        expect(true).toBe(false); // Should not reach here
      } catch (e) {
        expect((e as DOMException).name).toBe('AbortError');
      }
    });

    test('provides aborted signal when cancelled during execution', async () => {
      let signalAborted = false;

      const job = new Job(async ({ signal }) => {
        // Wait and check if signal gets aborted
        await new Promise<void>((resolve) => {
          const checkAbort = () => {
            signalAborted = signal?.aborted ?? false;
            resolve();
          };
          signal?.addEventListener('abort', checkAbort);
          setTimeout(checkAbort, 50);
        });
        return 'done';
      });

      // Prevent unhandled promise rejection from job.promise
      job.promise.catch(() => {});

      // Start execution and cancel shortly after
      const executePromise = job.execute();
      setTimeout(() => job.cancel(), 10);

      try {
        await executePromise;
      } catch {
        // Expected to throw or complete
      }

      expect(signalAborted).toBe(true);
    });
  });

  describe('external abort signal', () => {
    test('respects external abort signal', async () => {
      const controller = new AbortController();
      const job = new Job(async () => 'result', { signal: controller.signal });

      // Prevent unhandled promise rejection from job.promise
      job.promise.catch(() => {});

      controller.abort();

      try {
        await job.execute();
        expect(true).toBe(false); // Should not reach here
      } catch (e) {
        expect((e as DOMException).name).toBe('AbortError');
      }
      expect(job.status).toBe('cancelled');
    });

    test('combines external signal with internal signal', async () => {
      const controller = new AbortController();
      let receivedSignal: AbortSignal | undefined;

      const job = new Job(
        async ({ signal }) => {
          receivedSignal = signal;
          return 'done';
        },
        { signal: controller.signal },
      );

      await job.execute();
      expect(receivedSignal).toBeDefined();
    });
  });

  describe('promise property', () => {
    test('exposes the result promise', async () => {
      const job = new Job(async () => 'result');

      // Execute and wait
      job.execute();
      const result = await job.promise;

      expect(result).toBe('result');
    });

    test('promise rejects when job fails', async () => {
      const job = new Job(async () => {
        throw new Error('failed');
      });

      job.execute().catch(() => {}); // Prevent unhandled rejection

      await expect(job.promise).rejects.toThrow('failed');
    });
  });

  describe('timeout', () => {
    test('job completes before timeout - no error', async () => {
      const job = new Job(
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return 'done';
        },
        { timeout: 100 },
      );

      const result = await job.execute();
      expect(result).toBe('done');
      expect(job.status).toBe('completed');
    });

    test('job exceeds timeout - rejects with TimeoutError', async () => {
      const job = new Job(
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 200));
          return 'done';
        },
        { timeout: 50 },
      );

      job.promise.catch(() => {}); // Prevent unhandled rejection

      await expect(job.execute()).rejects.toBeInstanceOf(TimeoutError);
      expect(job.status).toBe('failed');
    });

    test('timeout triggers abort signal', async () => {
      let signalAborted = false;

      const job = new Job(
        async ({ signal }) => {
          await new Promise<void>((resolve) => {
            const checkAbort = () => {
              signalAborted = signal?.aborted ?? false;
              resolve();
            };
            signal?.addEventListener('abort', checkAbort);
            setTimeout(checkAbort, 200);
          });
          return 'done';
        },
        { timeout: 50 },
      );

      job.promise.catch(() => {}); // Prevent unhandled rejection

      try {
        await job.execute();
      } catch {
        // Expected
      }

      expect(signalAborted).toBe(true);
    });

    test('timeout of 0 means no timeout', async () => {
      const job = new Job(
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 50));
          return 'done';
        },
        { timeout: 0 },
      );

      const result = await job.execute();
      expect(result).toBe('done');
      expect(job.status).toBe('completed');
    });

    test('timeout of undefined means no timeout', async () => {
      const job = new Job(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return 'done';
      });

      const result = await job.execute();
      expect(result).toBe('done');
      expect(job.status).toBe('completed');
    });

    test('timeout works with external signal', async () => {
      const controller = new AbortController();

      const job = new Job(
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 200));
          return 'done';
        },
        { timeout: 50, signal: controller.signal },
      );

      job.promise.catch(() => {}); // Prevent unhandled rejection

      await expect(job.execute()).rejects.toBeInstanceOf(TimeoutError);
      expect(job.status).toBe('failed');
    });

    test('external abort before timeout - AbortError not TimeoutError', async () => {
      const controller = new AbortController();

      const job = new Job(
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 200));
          return 'done';
        },
        { timeout: 100, signal: controller.signal },
      );

      job.promise.catch(() => {}); // Prevent unhandled rejection

      // Abort externally before timeout
      setTimeout(() => controller.abort(), 20);

      try {
        await job.execute();
        expect(true).toBe(false); // Should not reach
      } catch (e) {
        expect((e as DOMException).name).toBe('AbortError');
      }
      expect(job.status).toBe('cancelled');
    });

    test('timeout error includes timeout duration in message', async () => {
      const job = new Job(
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 200));
          return 'done';
        },
        { timeout: 50 },
      );

      job.promise.catch(() => {}); // Prevent unhandled rejection

      try {
        await job.execute();
        expect(true).toBe(false); // Should not reach
      } catch (e) {
        expect((e as TimeoutError).message).toContain('50');
      }
    });

    test('timeout timer is cleaned up on normal completion', async () => {
      // This test verifies no memory leaks - the timeout should be cleared
      // We can't directly test clearTimeout, but we can verify behavior
      const job = new Job(
        async () => {
          return 'fast';
        },
        { timeout: 1000 },
      );

      const result = await job.execute();
      expect(result).toBe('fast');
      expect(job.status).toBe('completed');

      // Wait a bit to ensure no delayed timeout effects
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(job.status).toBe('completed'); // Still completed, not failed
    });
  });
});
