/**
 * Throughput benchmark scenario
 * Measures maximum operations per second under various configurations
 */

import { RateLimiter } from "../../src/index.js";
import type { BenchmarkDefinition } from "../lib/runner.js";
import { simulateWork } from "../lib/utils.js";
import type { RateLimiterConfig } from "../configs/types.js";

export interface ThroughputScenarioOptions {
  /** Number of operations to run */
  operations?: number;
  /** Work simulation options */
  workload?: {
    asyncDelayMs?: number;
    cpuIterations?: number;
  };
  /** Concurrency levels to test */
  concurrencyLevels?: number[];
}

const DEFAULT_OPTIONS: Required<ThroughputScenarioOptions> = {
  operations: 10000,
  workload: {
    asyncDelayMs: 0,
    cpuIterations: 0,
  },
  concurrencyLevels: [1, 5, 10, 50, 100],
};

/**
 * Create throughput benchmarks for a given configuration
 */
export function createThroughputBenchmarks(
  config: RateLimiterConfig,
  options: ThroughputScenarioOptions = {}
): BenchmarkDefinition[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const benchmarks: BenchmarkDefinition[] = [];

  for (const concurrency of opts.concurrencyLevels) {
    // Each benchmark needs its own limiter closure
    let limiter: RateLimiter | null = null;

    benchmarks.push({
      name: `Throughput: ${config.name}`,
      config: `concurrency=${concurrency}, ops=${opts.operations}`,
      setup: async () => {
        limiter = new RateLimiter({
          concurrency,
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
          await simulateWork(opts.workload);
        });
      },
      options: {
        operations: opts.operations,
        concurrency: Math.min(concurrency * 2, 200), // Allow some queuing pressure
        showProgress: true,
        progressLabel: `${config.name} (c=${concurrency})`,
      },
    });
  }

  return benchmarks;
}

/**
 * Create a single throughput benchmark with shared limiter
 */
export function createSharedLimiterThroughputBenchmark(
  config: RateLimiterConfig,
  options: {
    operations?: number;
    concurrency?: number;
    workload?: { asyncDelayMs?: number; cpuIterations?: number };
  } = {}
): BenchmarkDefinition {
  const {
    operations = 10000,
    concurrency = 10,
    workload = { asyncDelayMs: 0, cpuIterations: 0 },
  } = options;

  let limiter: RateLimiter | null = null;

  return {
    name: `Throughput: ${config.name}`,
    config: `concurrency=${concurrency}, ops=${operations}`,
    setup: async () => {
      limiter = new RateLimiter({
        concurrency,
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
        await simulateWork(workload);
      });
    },
    options: {
      operations,
      concurrency: Math.min(concurrency * 2, 200), // Allow some queuing pressure
      showProgress: true,
      progressLabel: config.name,
    },
  };
}

/**
 * Find maximum sustainable throughput for a configuration
 */
export async function findMaxThroughput(
  config: RateLimiterConfig,
  options: {
    targetOpsPerSecond?: number;
    testDurationMs?: number;
    workload?: { asyncDelayMs?: number; cpuIterations?: number };
  } = {}
): Promise<{
  maxOpsPerSecond: number;
  sustainableConcurrency: number;
  bottleneck: "cpu" | "limiter" | "workload" | "unknown";
}> {
  const {
    targetOpsPerSecond = 100000,
    testDurationMs = 5000,
    workload = { asyncDelayMs: 0, cpuIterations: 0 },
  } = options;

  let maxOpsPerSecond = 0;
  let sustainableConcurrency = 1;

  // Binary search for optimal concurrency
  const concurrencyLevels = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];

  for (const concurrency of concurrencyLevels) {
    const limiter = new RateLimiter({
      concurrency,
      ...config.options,
    });

    const startTime = performance.now();
    let operations = 0;
    const pending: Promise<void>[] = [];

    while (performance.now() - startTime < testDurationMs) {
      // Keep queue filled
      while (pending.length < concurrency * 2) {
        const promise = limiter
          .add(async () => {
            await simulateWork(workload);
          })
          .then(() => {
            operations++;
            const idx = pending.indexOf(promise);
            if (idx !== -1) pending.splice(idx, 1);
          })
          .catch(() => {
            const idx = pending.indexOf(promise);
            if (idx !== -1) pending.splice(idx, 1);
          });
        pending.push(promise);
      }

      await Promise.race(pending);
    }

    // Drain remaining
    await Promise.all(pending);
    limiter.clear();

    const elapsed = performance.now() - startTime;
    const opsPerSecond = (operations / elapsed) * 1000;

    if (opsPerSecond > maxOpsPerSecond) {
      maxOpsPerSecond = opsPerSecond;
      sustainableConcurrency = concurrency;
    }

    // If we've hit the target or started declining, stop
    if (opsPerSecond >= targetOpsPerSecond || opsPerSecond < maxOpsPerSecond * 0.9) {
      break;
    }
  }

  // Determine bottleneck
  let bottleneck: "cpu" | "limiter" | "workload" | "unknown" = "unknown";

  if (workload.asyncDelayMs && workload.asyncDelayMs > 0) {
    const theoreticalMax = (1000 / workload.asyncDelayMs) * sustainableConcurrency;
    if (maxOpsPerSecond >= theoreticalMax * 0.9) {
      bottleneck = "workload";
    }
  } else if (workload.cpuIterations && workload.cpuIterations > 1000000) {
    bottleneck = "cpu";
  } else if (config.options?.limits) {
    bottleneck = "limiter";
  }

  return {
    maxOpsPerSecond: Math.round(maxOpsPerSecond),
    sustainableConcurrency,
    bottleneck,
  };
}
