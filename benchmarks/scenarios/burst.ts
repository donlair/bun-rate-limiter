/**
 * Burst benchmark scenario
 * Tests how well the limiter handles sudden spikes in load
 */

import { RateLimiter } from "../../src/index.js";
import type { BenchmarkDefinition } from "../lib/runner.js";
import { now, delay, forceGC } from "../lib/utils.js";
import type { RateLimiterConfig } from "../configs/types.js";
import { Histogram } from "../lib/metrics.js";

export interface BurstScenarioOptions {
  /** Number of tasks per burst */
  burstSize?: number;
  /** Number of bursts to send */
  burstCount?: number;
  /** Delay between bursts in ms */
  burstIntervalMs?: number;
  /** Concurrency level */
  concurrency?: number;
}

const DEFAULT_OPTIONS: Required<BurstScenarioOptions> = {
  burstSize: 100,
  burstCount: 10,
  burstIntervalMs: 500,
  concurrency: 10,
};

/**
 * Create a burst handling benchmark
 */
export function createBurstBenchmark(
  config: RateLimiterConfig,
  options: BurstScenarioOptions = {}
): BenchmarkDefinition {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let limiter: RateLimiter | null = null;

  return {
    name: `Burst Handling: ${config.name}`,
    config: `burst=${opts.burstSize}x${opts.burstCount}, interval=${opts.burstIntervalMs}ms`,
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
    fn: async ({ operationIndex }) => {
      if (!limiter) throw new Error("Limiter not initialized");

      // Each operation represents one task in a burst
      await limiter.add(async () => {
        // Minimal work
        await delay(0);
      });
    },
    options: {
      operations: opts.burstSize * opts.burstCount,
      concurrency: opts.burstSize, // Submit entire burst at once
      showProgress: true,
      progressLabel: `${config.name} burst`,
    },
  };
}

/**
 * Analyze burst handling behavior in detail
 */
export async function analyzeBurstBehavior(
  config: RateLimiterConfig,
  options: BurstScenarioOptions = {}
): Promise<{
  bursts: Array<{
    burstIndex: number;
    submissionTimeMs: number;
    firstCompletionMs: number;
    lastCompletionMs: number;
    avgLatencyMs: number;
    maxQueueSize: number;
  }>;
  overall: {
    totalTasks: number;
    totalTimeMs: number;
    avgThroughput: number;
    peakQueueSize: number;
    latencyP50: number;
    latencyP99: number;
  };
}> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  const limiter = new RateLimiter({
    concurrency: opts.concurrency,
    ...config.options,
  });

  const burstResults: Array<{
    burstIndex: number;
    submissionTimeMs: number;
    firstCompletionMs: number;
    lastCompletionMs: number;
    avgLatencyMs: number;
    maxQueueSize: number;
  }> = [];

  const allLatencies = new Histogram();
  let peakQueueSize = 0;
  let totalErrors = 0;
  const startTime = now();

  for (let burst = 0; burst < opts.burstCount; burst++) {
    const burstStartTime = now();
    const burstLatencies: number[] = [];
    let firstCompletion: number | null = null;
    let lastCompletion = 0;
    let maxQueueSize = 0;
    let burstErrors = 0;

    // Submit entire burst at once
    const promises: Promise<void>[] = [];

    for (let i = 0; i < opts.burstSize; i++) {
      const taskAddTime = now();

      const promise = limiter
        .add(async () => {
          const startTime = now();
          const latency = startTime - taskAddTime;
          burstLatencies.push(latency);
          allLatencies.add(latency);

          // Track queue size
          const queueSize = limiter!.size;
          if (queueSize > maxQueueSize) {
            maxQueueSize = queueSize;
          }
          if (queueSize > peakQueueSize) {
            peakQueueSize = queueSize;
          }

          await delay(0);
        })
        .then(() => {
          const completionTime = now();
          if (firstCompletion === null) {
            firstCompletion = completionTime;
          }
          lastCompletion = completionTime;
        })
        .catch((error) => {
          burstErrors++;
          totalErrors++;
          if (burstErrors <= 3) {
            console.warn(
              `  [burst ${burst}] Task failed:`,
              error instanceof Error ? error.message : error
            );
          }
        });

      promises.push(promise);
    }

    await Promise.all(promises);

    burstResults.push({
      burstIndex: burst,
      submissionTimeMs: burstStartTime - startTime,
      firstCompletionMs: (firstCompletion ?? burstStartTime) - startTime,
      lastCompletionMs: lastCompletion - startTime,
      avgLatencyMs:
        burstLatencies.reduce((a, b) => a + b, 0) / burstLatencies.length,
      maxQueueSize,
    });

    // Wait between bursts
    if (burst < opts.burstCount - 1) {
      await delay(opts.burstIntervalMs);
    }
  }

  limiter.clear();

  const totalTimeMs = now() - startTime;

  return {
    bursts: burstResults,
    overall: {
      totalTasks: opts.burstSize * opts.burstCount,
      totalTimeMs,
      avgThroughput:
        ((opts.burstSize * opts.burstCount) / totalTimeMs) * 1000,
      peakQueueSize,
      latencyP50: allLatencies.percentile(50),
      latencyP99: allLatencies.percentile(99),
    },
  };
}

/**
 * Test burst recovery - how quickly the system returns to normal after a burst
 */
export async function measureBurstRecovery(
  config: RateLimiterConfig,
  options: {
    burstSize?: number;
    concurrency?: number;
    measurementDurationMs?: number;
  } = {}
): Promise<{
  burstDurationMs: number;
  recoveryTimeMs: number;
  steadyStateLatencyMs: number;
  peakLatencyMs: number;
}> {
  const { burstSize = 500, concurrency = 10, measurementDurationMs = 5000 } = options;

  const limiter = new RateLimiter({
    concurrency,
    ...config.options,
  });

  // Establish steady state first
  const steadyStateLatencies: number[] = [];
  for (let i = 0; i < 100; i++) {
    const start = now();
    await limiter.add(async () => {
      await delay(0);
    });
    steadyStateLatencies.push(now() - start);
  }

  const steadyStateLatencyMs =
    steadyStateLatencies.reduce((a, b) => a + b, 0) / steadyStateLatencies.length;

  // Send burst
  const burstStart = now();
  const burstPromises: Promise<void>[] = [];
  let peakLatencyMs = 0;
  let burstErrors = 0;

  for (let i = 0; i < burstSize; i++) {
    const taskStart = now();
    const promise = limiter
      .add(async () => {
        const latency = now() - taskStart;
        if (latency > peakLatencyMs) {
          peakLatencyMs = latency;
        }
        await delay(0);
      })
      .catch((error) => {
        burstErrors++;
        if (burstErrors <= 3) {
          console.warn(
            `  [burst recovery] Task failed:`,
            error instanceof Error ? error.message : error
          );
        }
      });
    burstPromises.push(promise);
  }

  await Promise.all(burstPromises);
  const burstDurationMs = now() - burstStart;

  // Measure recovery - time until latency returns to steady state
  const recoveryStart = now();
  let recovered = false;
  let recoveryTimeMs = 0;

  while (now() - recoveryStart < measurementDurationMs && !recovered) {
    const start = now();
    await limiter.add(async () => {
      await delay(0);
    });
    const latency = now() - start;

    // Consider recovered if latency is within 2x steady state
    if (latency <= steadyStateLatencyMs * 2) {
      recovered = true;
      recoveryTimeMs = now() - recoveryStart;
    }
  }

  limiter.clear();

  return {
    burstDurationMs,
    recoveryTimeMs,
    steadyStateLatencyMs,
    peakLatencyMs,
  };
}

/**
 * Test multiple concurrent bursts from different "clients"
 */
export async function measureConcurrentBursts(
  config: RateLimiterConfig,
  options: {
    clientCount?: number;
    burstSizePerClient?: number;
    concurrency?: number;
  } = {}
): Promise<{
  totalTasks: number;
  totalTimeMs: number;
  throughput: number;
  fairness: number; // 0-1, where 1 is perfectly fair
  clientResults: Array<{
    clientId: number;
    completedTasks: number;
    avgLatencyMs: number;
  }>;
}> {
  const { clientCount = 5, burstSizePerClient = 100, concurrency = 20 } = options;

  const limiter = new RateLimiter({
    concurrency,
    ...config.options,
  });

  const clientResults: Map<
    number,
    { completed: number; latencies: number[] }
  > = new Map();

  for (let i = 0; i < clientCount; i++) {
    clientResults.set(i, { completed: 0, latencies: [] });
  }

  const startTime = now();
  const allPromises: Promise<void>[] = [];
  let totalErrors = 0;

  // All clients submit bursts simultaneously
  for (let clientId = 0; clientId < clientCount; clientId++) {
    for (let i = 0; i < burstSizePerClient; i++) {
      const taskStart = now();

      const promise = limiter
        .add(async () => {
          await delay(0);
        })
        .then(() => {
          const latency = now() - taskStart;
          const client = clientResults.get(clientId)!;
          client.completed++;
          client.latencies.push(latency);
        })
        .catch((error) => {
          totalErrors++;
          if (totalErrors <= 3) {
            console.warn(
              `  [concurrent bursts] Client ${clientId} task failed:`,
              error instanceof Error ? error.message : error
            );
          }
        });

      allPromises.push(promise);
    }
  }

  await Promise.all(allPromises);
  const totalTimeMs = now() - startTime;

  limiter.clear();

  // Calculate fairness (coefficient of variation of completion rates)
  const completedCounts = Array.from(clientResults.values()).map(
    (r) => r.completed
  );
  const avgCompleted =
    completedCounts.reduce((a, b) => a + b, 0) / clientCount;
  const variance =
    completedCounts.reduce((sum, c) => sum + (c - avgCompleted) ** 2, 0) /
    clientCount;
  const stdDev = Math.sqrt(variance);
  const fairness = avgCompleted > 0 ? 1 - stdDev / avgCompleted : 1;

  return {
    totalTasks: clientCount * burstSizePerClient,
    totalTimeMs,
    throughput: ((clientCount * burstSizePerClient) / totalTimeMs) * 1000,
    fairness: Math.max(0, Math.min(1, fairness)),
    clientResults: Array.from(clientResults.entries()).map(
      ([clientId, data]) => ({
        clientId,
        completedTasks: data.completed,
        avgLatencyMs:
          data.latencies.length > 0
            ? data.latencies.reduce((a, b) => a + b, 0) / data.latencies.length
            : 0,
      })
    ),
  };
}
