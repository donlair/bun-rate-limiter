/**
 * Sustained load benchmark scenario
 * Tests system stability under prolonged load
 */

import { RateLimiter } from "../../src/index.js";
import { now, delay, forceGC, formatBytes, formatNumber } from "../lib/utils.js";
import type { RateLimiterConfig } from "../configs/types.js";
import { Histogram } from "../lib/metrics.js";
import { MemoryTracker } from "../lib/memory-tracker.js";

export interface SustainedLoadOptions {
  /** Duration of the test in ms */
  durationMs?: number;
  /** Target operations per second */
  targetOpsPerSecond?: number;
  /** Concurrency level */
  concurrency?: number;
  /** Report interval in ms */
  reportIntervalMs?: number;
  /** Task work simulation */
  taskDelayMs?: number;
}

const DEFAULT_OPTIONS: Required<SustainedLoadOptions> = {
  durationMs: 60000, // 1 minute
  targetOpsPerSecond: 1000,
  concurrency: 10,
  reportIntervalMs: 5000,
  taskDelayMs: 0,
};

export interface SustainedLoadReport {
  intervals: Array<{
    intervalIndex: number;
    timestamp: number;
    opsInInterval: number;
    opsPerSecond: number;
    latencyP50: number;
    latencyP99: number;
    heapUsed: number;
    queueSize: number;
    errors: number;
  }>;
  summary: {
    totalDurationMs: number;
    totalOperations: number;
    avgOpsPerSecond: number;
    minOpsPerSecond: number;
    maxOpsPerSecond: number;
    latencyP50: number;
    latencyP99: number;
    memoryGrowth: number;
    totalErrors: number;
    stabilityScore: number; // 0-1, where 1 is perfectly stable
  };
}

/**
 * Run sustained load test with periodic reporting
 */
export async function runSustainedLoadTest(
  config: RateLimiterConfig,
  options: SustainedLoadOptions = {},
  onIntervalReport?: (report: SustainedLoadReport["intervals"][0]) => void
): Promise<SustainedLoadReport> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  const limiter = new RateLimiter({
    concurrency: opts.concurrency,
    ...config.options,
  });

  const memoryTracker = new MemoryTracker({
    snapshotIntervalMs: opts.reportIntervalMs,
    forceGCBeforeSnapshot: false,
  });

  const intervals: SustainedLoadReport["intervals"] = [];
  const allLatencies = new Histogram();

  let intervalLatencies = new Histogram();
  let intervalErrors = 0;
  let intervalOps = 0;
  let totalErrors = 0;

  const testStart = now();
  let lastReportTime = testStart;
  let intervalIndex = 0;

  const pending: Promise<void>[] = [];
  const intervalMs = 1000 / opts.targetOpsPerSecond;
  let nextSubmitTime = testStart;

  memoryTracker.takeSnapshot();

  while (now() - testStart < opts.durationMs) {
    const currentTime = now();

    // Check if it's time to report
    if (currentTime - lastReportTime >= opts.reportIntervalMs) {
      forceGC();

      const report = {
        intervalIndex,
        timestamp: currentTime - testStart,
        opsInInterval: intervalOps,
        opsPerSecond: (intervalOps / opts.reportIntervalMs) * 1000,
        latencyP50: intervalLatencies.percentile(50),
        latencyP99: intervalLatencies.percentile(99),
        heapUsed: process.memoryUsage().heapUsed,
        queueSize: limiter.size,
        errors: intervalErrors,
      };

      intervals.push(report);

      if (onIntervalReport) {
        onIntervalReport(report);
      }

      memoryTracker.takeSnapshot();

      // Reset interval counters
      intervalLatencies = new Histogram();
      intervalErrors = 0;
      intervalOps = 0;
      lastReportTime = currentTime;
      intervalIndex++;
    }

    // Submit task at target rate
    if (currentTime >= nextSubmitTime) {
      const taskStart = now();

      const promise = limiter
        .add(async () => {
          if (opts.taskDelayMs > 0) {
            await delay(opts.taskDelayMs);
          }
        })
        .then(() => {
          const latency = now() - taskStart;
          intervalLatencies.add(latency);
          allLatencies.add(latency);
          intervalOps++;
        })
        .catch(() => {
          intervalErrors++;
          totalErrors++;
        })
        .finally(() => {
          const idx = pending.indexOf(promise);
          if (idx !== -1) pending.splice(idx, 1);
        });

      pending.push(promise);
      nextSubmitTime += intervalMs;

      // Catch up if we're behind
      if (nextSubmitTime < currentTime) {
        nextSubmitTime = currentTime + intervalMs;
      }
    }

    // Prevent queue from growing unboundedly
    if (pending.length > opts.concurrency * 10) {
      await Promise.race(pending);
    }

    // Small yield to prevent blocking
    await delay(0);
  }

  // Wait for remaining tasks
  await Promise.all(pending);
  limiter.clear();

  memoryTracker.takeSnapshot();
  const snapshots = memoryTracker.getSnapshots();

  const totalDurationMs = now() - testStart;
  const totalOperations = allLatencies.count;

  // Calculate stability score based on throughput variance
  const opsPerSecondValues = intervals.map((i) => i.opsPerSecond);
  const avgOps =
    opsPerSecondValues.length > 0
      ? opsPerSecondValues.reduce((a, b) => a + b, 0) / opsPerSecondValues.length
      : 0;
  const variance =
    opsPerSecondValues.length > 0
      ? opsPerSecondValues.reduce((sum, v) => sum + (v - avgOps) ** 2, 0) /
        opsPerSecondValues.length
      : 0;
  const stdDev = Math.sqrt(variance);
  const coeffOfVariation = avgOps > 0 ? stdDev / avgOps : 0;
  const stabilityScore = Math.max(0, 1 - coeffOfVariation);

  return {
    intervals,
    summary: {
      totalDurationMs,
      totalOperations,
      avgOpsPerSecond: (totalOperations / totalDurationMs) * 1000,
      minOpsPerSecond: opsPerSecondValues.length > 0 ? Math.min(...opsPerSecondValues) : 0,
      maxOpsPerSecond: opsPerSecondValues.length > 0 ? Math.max(...opsPerSecondValues) : 0,
      latencyP50: allLatencies.percentile(50),
      latencyP99: allLatencies.percentile(99),
      memoryGrowth:
        snapshots.length > 1
          ? snapshots[snapshots.length - 1].heapUsed - snapshots[0].heapUsed
          : 0,
      totalErrors,
      stabilityScore,
    },
  };
}

/**
 * Report sustained load results to console
 */
export function reportSustainedLoadResults(
  name: string,
  report: SustainedLoadReport
): void {
  console.log();
  console.log("═".repeat(70));
  console.log(` Sustained Load Test: ${name}`);
  console.log("═".repeat(70));

  console.log(" Summary:");
  console.log(`   Duration:        ${(report.summary.totalDurationMs / 1000).toFixed(1)}s`);
  console.log(`   Total ops:       ${formatNumber(report.summary.totalOperations)}`);
  console.log(`   Avg throughput:  ${formatNumber(Math.round(report.summary.avgOpsPerSecond))} ops/s`);
  console.log(`   Min throughput:  ${formatNumber(Math.round(report.summary.minOpsPerSecond))} ops/s`);
  console.log(`   Max throughput:  ${formatNumber(Math.round(report.summary.maxOpsPerSecond))} ops/s`);
  console.log(`   Latency p50:     ${report.summary.latencyP50.toFixed(2)}ms`);
  console.log(`   Latency p99:     ${report.summary.latencyP99.toFixed(2)}ms`);
  console.log(`   Memory growth:   ${formatBytes(report.summary.memoryGrowth)}`);
  console.log(`   Errors:          ${report.summary.totalErrors}`);
  console.log(`   Stability:       ${(report.summary.stabilityScore * 100).toFixed(1)}%`);

  console.log();
  console.log(" Interval Breakdown:");
  console.log("─".repeat(70));
  console.log(
    "   " +
      "Time".padEnd(8) +
      "Ops/s".padStart(10) +
      "p50".padStart(10) +
      "p99".padStart(10) +
      "Heap".padStart(12) +
      "Queue".padStart(8) +
      "Errors".padStart(8)
  );
  console.log("─".repeat(70));

  for (const interval of report.intervals) {
    console.log(
      "   " +
        `${(interval.timestamp / 1000).toFixed(0)}s`.padEnd(8) +
        `${Math.round(interval.opsPerSecond)}`.padStart(10) +
        `${interval.latencyP50.toFixed(2)}ms`.padStart(10) +
        `${interval.latencyP99.toFixed(2)}ms`.padStart(10) +
        `${formatBytes(interval.heapUsed)}`.padStart(12) +
        `${interval.queueSize}`.padStart(8) +
        `${interval.errors}`.padStart(8)
    );
  }

  console.log("═".repeat(70));
  console.log();
}
