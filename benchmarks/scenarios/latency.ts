/**
 * Latency benchmark scenario
 * Measures task scheduling and execution latency
 */

import { RateLimiter } from "../../src/index.js";
import type { BenchmarkDefinition } from "../lib/runner.js";
import { now, delay } from "../lib/utils.js";
import type { RateLimiterConfig } from "../configs/types.js";
import { Histogram } from "../lib/metrics.js";

export interface LatencyScenarioOptions {
  /** Number of operations to run */
  operations?: number;
  /** Concurrency level */
  concurrency?: number;
  /** Target rate (ops/sec) - null for max rate */
  targetRate?: number | null;
}

const DEFAULT_OPTIONS: Required<LatencyScenarioOptions> = {
  operations: 5000,
  concurrency: 10,
  targetRate: null,
};

/**
 * Measure scheduling latency (time from add() to task start)
 */
export function createSchedulingLatencyBenchmark(
  config: RateLimiterConfig,
  options: LatencyScenarioOptions = {}
): BenchmarkDefinition {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let limiter: RateLimiter | null = null;

  return {
    name: `Scheduling Latency: ${config.name}`,
    config: `concurrency=${opts.concurrency}, ops=${opts.operations}`,
    setup: async () => {
      limiter = new RateLimiter({
        concurrency: opts.concurrency,
        ...config.options,
      });

      return {
        cleanup: async () => {
          limiter?.clear();
          limiter = null;
        },
      };
    },
    fn: async () => {
      if (!limiter) throw new Error("Limiter not initialized");

      const addTime = now();

      await limiter.add(async () => {
        const startTime = now();
        const schedulingLatency = startTime - addTime;
        // We're measuring the scheduling latency, not the task duration
        // The runner will measure total time, but we care about scheduling overhead
        return schedulingLatency;
      });
    },
    options: {
      operations: opts.operations,
      concurrency: opts.concurrency * 2, // Allow queue pressure
      showProgress: true,
      progressLabel: `${config.name} scheduling`,
    },
  };
}

/**
 * Measure end-to-end latency (add to completion)
 */
export function createE2ELatencyBenchmark(
  config: RateLimiterConfig,
  options: LatencyScenarioOptions & {
    taskDurationMs?: number;
  } = {}
): BenchmarkDefinition {
  const { taskDurationMs = 1, ...opts } = { ...DEFAULT_OPTIONS, ...options };
  let limiter: RateLimiter | null = null;

  return {
    name: `E2E Latency: ${config.name}`,
    config: `concurrency=${opts.concurrency}, taskDuration=${taskDurationMs}ms`,
    setup: async () => {
      limiter = new RateLimiter({
        concurrency: opts.concurrency,
        ...config.options,
      });

      return {
        cleanup: async () => {
          limiter?.clear();
          limiter = null;
        },
      };
    },
    fn: async () => {
      if (!limiter) throw new Error("Limiter not initialized");

      await limiter.add(async () => {
        if (taskDurationMs > 0) {
          await delay(taskDurationMs);
        }
      });
    },
    options: {
      operations: opts.operations,
      concurrency: opts.concurrency * 2,
      showProgress: true,
      progressLabel: `${config.name} e2e`,
    },
  };
}

/**
 * Detailed latency analysis with percentile breakdown
 */
export async function analyzeLatencyDistribution(
  config: RateLimiterConfig,
  options: {
    operations?: number;
    concurrency?: number;
    warmupOperations?: number;
  } = {}
): Promise<{
  scheduling: {
    histogram: Histogram;
    percentiles: { p50: number; p75: number; p90: number; p95: number; p99: number };
  };
  execution: {
    histogram: Histogram;
    percentiles: { p50: number; p75: number; p90: number; p95: number; p99: number };
  };
  queueWait: {
    histogram: Histogram;
    percentiles: { p50: number; p75: number; p90: number; p95: number; p99: number };
  };
}> {
  const { operations = 5000, concurrency = 10, warmupOperations = 100 } = options;

  const schedulingHistogram = new Histogram();
  const executionHistogram = new Histogram();
  const queueWaitHistogram = new Histogram();

  const limiter = new RateLimiter({
    concurrency,
    ...config.options,
  });

  // Warmup
  const warmupPromises: Promise<void>[] = [];
  for (let i = 0; i < warmupOperations; i++) {
    warmupPromises.push(limiter.add(async () => {}));
  }
  await Promise.all(warmupPromises);

  // Measurement phase
  const pending: Promise<void>[] = [];

  for (let i = 0; i < operations; i++) {
    const addTime = now();

    const promise = limiter
      .add(async () => {
        const startTime = now();
        const schedulingLatency = startTime - addTime;
        schedulingHistogram.add(schedulingLatency);

        // Simulate minimal work
        await delay(0);

        const endTime = now();
        executionHistogram.add(endTime - startTime);
      })
      .then(() => {
        const completeTime = now();
        queueWaitHistogram.add(completeTime - addTime);
      });

    pending.push(promise);

    // Control submission rate to avoid overwhelming
    if (pending.length >= concurrency * 3) {
      await Promise.race(pending);
      // Clean up completed promises
      const stillPending = pending.filter((p) => {
        let resolved = false;
        p.then(() => (resolved = true)).catch(() => (resolved = true));
        return !resolved;
      });
      pending.length = 0;
      pending.push(...stillPending);
    }
  }

  await Promise.all(pending);
  limiter.clear();

  const getPercentiles = (h: Histogram) => ({
    p50: h.percentile(50),
    p75: h.percentile(75),
    p90: h.percentile(90),
    p95: h.percentile(95),
    p99: h.percentile(99),
  });

  return {
    scheduling: {
      histogram: schedulingHistogram,
      percentiles: getPercentiles(schedulingHistogram),
    },
    execution: {
      histogram: executionHistogram,
      percentiles: getPercentiles(executionHistogram),
    },
    queueWait: {
      histogram: queueWaitHistogram,
      percentiles: getPercentiles(queueWaitHistogram),
    },
  };
}

/**
 * Measure latency under sustained load
 */
export async function measureLatencyUnderLoad(
  config: RateLimiterConfig,
  options: {
    durationMs?: number;
    targetRatePerSecond?: number;
    concurrency?: number;
  } = {}
): Promise<{
  achievedRate: number;
  latencyPercentiles: { p50: number; p95: number; p99: number };
  droppedTasks: number;
}> {
  const { durationMs = 10000, targetRatePerSecond = 1000, concurrency = 10 } = options;

  const histogram = new Histogram();
  const limiter = new RateLimiter({
    concurrency,
    ...config.options,
  });

  const intervalMs = 1000 / targetRatePerSecond;
  const startTime = now();
  let submitted = 0;
  let completed = 0;
  let dropped = 0;

  const pending: Promise<void>[] = [];

  while (now() - startTime < durationMs) {
    const taskAddTime = now();

    const promise = limiter
      .add(async () => {
        const startTime = now();
        histogram.add(startTime - taskAddTime);
        await delay(0);
      })
      .then(() => {
        completed++;
      })
      .catch(() => {
        dropped++;
      })
      .finally(() => {
        const idx = pending.indexOf(promise);
        if (idx !== -1) pending.splice(idx, 1);
      });

    pending.push(promise);
    submitted++;

    // Rate limiting for submission
    const expectedTime = startTime + submitted * intervalMs;
    const currentTime = now();
    if (currentTime < expectedTime) {
      await delay(expectedTime - currentTime);
    }
  }

  await Promise.all(pending);
  limiter.clear();

  const elapsed = now() - startTime;
  const achievedRate = (completed / elapsed) * 1000;

  return {
    achievedRate: Math.round(achievedRate),
    latencyPercentiles: {
      p50: histogram.percentile(50),
      p95: histogram.percentile(95),
      p99: histogram.percentile(99),
    },
    droppedTasks: dropped,
  };
}
