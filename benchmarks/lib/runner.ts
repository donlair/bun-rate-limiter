/**
 * Core benchmark runner
 */

import { MetricsCollector, Timer, type BenchmarkMetrics } from "./metrics.js";
import { MemoryTracker, type MemoryLeakReport } from "./memory-tracker.js";
import { forceGC, delay, getRuntime } from "./utils.js";
import { reportProgress } from "./reporters/console.js";

export interface BenchmarkOptions {
  /** Number of operations to run @default 10000 */
  operations?: number;
  /** Number of warmup operations @default 100 */
  warmupOperations?: number;
  /** Maximum duration in ms (overrides operations if reached first) @default 60000 */
  maxDurationMs?: number;
  /** Concurrency level @default 1 */
  concurrency?: number;
  /** Whether to track memory during the benchmark @default true */
  trackMemory?: boolean;
  /** Whether to detect memory leaks @default false */
  detectLeaks?: boolean;
  /** Memory snapshot interval in ms @default 1000 */
  memorySnapshotIntervalMs?: number;
  /** Show progress bar @default true */
  showProgress?: boolean;
  /** Label for progress bar @default "Running" */
  progressLabel?: string;
}

export interface BenchmarkResult {
  name: string;
  config: string;
  metrics: BenchmarkMetrics;
  memoryLeakReport?: MemoryLeakReport;
  runtime: { name: string; version: string };
}

const DEFAULT_OPTIONS: Required<BenchmarkOptions> = {
  operations: 10000,
  warmupOperations: 100,
  maxDurationMs: 60000,
  concurrency: 1,
  trackMemory: true,
  detectLeaks: false,
  memorySnapshotIntervalMs: 1000,
  showProgress: true,
  progressLabel: "Running",
};

export type BenchmarkFn = (context: {
  operationIndex: number;
  signal?: AbortSignal;
}) => Promise<void>;

export type SetupFn = () => Promise<{ cleanup?: () => Promise<void> }>;

export interface BenchmarkDefinition {
  name: string;
  config: string;
  setup?: SetupFn;
  fn: BenchmarkFn;
  options?: BenchmarkOptions;
}

/**
 * Run a single benchmark
 */
export async function runBenchmark(
  definition: BenchmarkDefinition
): Promise<BenchmarkResult> {
  const options = { ...DEFAULT_OPTIONS, ...definition.options };
  const { name, config, setup, fn } = definition;
  const runtime = getRuntime();

  // Setup
  let cleanup: (() => Promise<void>) | undefined;
  if (setup) {
    const result = await setup();
    cleanup = result.cleanup;
  }

  const collector = new MetricsCollector();
  const memoryTracker = options.trackMemory
    ? new MemoryTracker({ snapshotIntervalMs: options.memorySnapshotIntervalMs })
    : null;

  try {
    // Warmup phase - errors are logged but don't abort the benchmark
    if (options.warmupOperations > 0) {
      let warmupErrors = 0;
      for (let i = 0; i < options.warmupOperations; i++) {
        try {
          await fn({ operationIndex: i });
        } catch (error) {
          // Warmup failures may be expected (e.g., rate limiting during warmup)
          warmupErrors++;
          if (warmupErrors <= 3) {
            console.warn(
              `  [warmup] Operation ${i} failed:`,
              error instanceof Error ? error.message : error
            );
          }
        }
      }
      if (warmupErrors > 3) {
        console.warn(`  [warmup] ... and ${warmupErrors - 3} more errors`);
      }
    }

    // Force GC before main run
    forceGC();
    await delay(50);

    // Start tracking
    collector.start();
    if (memoryTracker && options.detectLeaks) {
      memoryTracker.startTracking();
    }

    const startTime = performance.now();
    let completed = 0;

    // Run operations with concurrency
    const runOperation = async (index: number): Promise<void> => {
      const timer = new Timer();
      timer.start();

      try {
        await fn({ operationIndex: index });
        const duration = timer.stop();
        collector.recordLatency(duration);
      } catch (error) {
        if (
          error instanceof Error &&
          error.name === "TimeoutError"
        ) {
          collector.recordTimeout();
        } else {
          collector.recordError();
        }
      }

      completed++;

      if (options.showProgress && completed % 100 === 0) {
        reportProgress(completed, options.operations, options.progressLabel, {
          useColors: true,
        });
      }

      // Periodically update peak memory
      if (options.trackMemory && completed % 1000 === 0) {
        collector.updatePeakMemory();
      }
    };

    // Execute with concurrency
    const pending: Promise<void>[] = [];
    let nextIndex = 0;

    while (
      nextIndex < options.operations &&
      performance.now() - startTime < options.maxDurationMs
    ) {
      // Fill up to concurrency limit
      while (
        pending.length < options.concurrency &&
        nextIndex < options.operations
      ) {
        const index = nextIndex++;
        const promise = runOperation(index).then(() => {
          // Remove from pending when done
          const idx = pending.indexOf(promise);
          if (idx !== -1) pending.splice(idx, 1);
        });
        pending.push(promise);
      }

      // Wait for at least one to complete
      if (pending.length >= options.concurrency) {
        await Promise.race(pending);
      }
    }

    // Wait for remaining operations
    await Promise.all(pending);

    // Final progress update
    if (options.showProgress) {
      reportProgress(completed, options.operations, options.progressLabel, {
        useColors: true,
      });
    }

    // Stop tracking
    collector.stop();

    // Memory leak analysis
    let memoryLeakReport: MemoryLeakReport | undefined;
    if (memoryTracker && options.detectLeaks) {
      memoryTracker.stopTracking();
      memoryLeakReport = memoryTracker.analyzeLeaks();
    }

    return {
      name,
      config,
      metrics: collector.getMetrics(),
      memoryLeakReport,
      runtime,
    };
  } finally {
    // Cleanup - always attempt, even on error
    if (cleanup) {
      try {
        await cleanup();
      } catch (cleanupError) {
        // Cleanup errors shouldn't mask the original error, but we log them
        console.warn(
          `  [cleanup] Failed:`,
          cleanupError instanceof Error ? cleanupError.message : cleanupError
        );
      }
    }
  }
}

/**
 * Run multiple benchmarks in sequence
 */
export async function runBenchmarkSuite(
  benchmarks: BenchmarkDefinition[],
  options: {
    delayBetweenBenchmarksMs?: number;
    onBenchmarkComplete?: (result: BenchmarkResult, index: number) => void;
  } = {}
): Promise<BenchmarkResult[]> {
  const { delayBetweenBenchmarksMs = 1000, onBenchmarkComplete } = options;
  const results: BenchmarkResult[] = [];

  for (let i = 0; i < benchmarks.length; i++) {
    const benchmark = benchmarks[i];

    // Force GC between benchmarks
    forceGC();
    await delay(delayBetweenBenchmarksMs);

    const result = await runBenchmark(benchmark);
    results.push(result);

    if (onBenchmarkComplete) {
      onBenchmarkComplete(result, i);
    }
  }

  return results;
}

/**
 * Create a simple benchmark from a function
 */
export function createBenchmark(
  name: string,
  config: string,
  fn: BenchmarkFn,
  options?: BenchmarkOptions
): BenchmarkDefinition {
  return { name, config, fn, options };
}

/**
 * Helper to run a function N times and measure throughput
 */
export async function measureThroughput(
  fn: () => Promise<void>,
  options: {
    operations?: number;
    warmupOperations?: number;
    concurrency?: number;
  } = {}
): Promise<{ opsPerSecond: number; totalTimeMs: number; errorCount: number }> {
  const {
    operations = 10000,
    warmupOperations = 100,
    concurrency = 1,
  } = options;

  // Warmup
  for (let i = 0; i < warmupOperations; i++) {
    await fn();
  }

  forceGC();

  const startTime = performance.now();

  // Run with concurrency
  const pending: Promise<void>[] = [];
  let completed = 0;
  let errorCount = 0;

  while (completed + errorCount < operations) {
    while (pending.length < concurrency && completed + errorCount + pending.length < operations) {
      const promise = fn()
        .then(() => {
          completed++;
        })
        .catch(() => {
          errorCount++;
        })
        .finally(() => {
          const idx = pending.indexOf(promise);
          if (idx !== -1) pending.splice(idx, 1);
        });
      pending.push(promise);
    }

    if (pending.length > 0) {
      await Promise.race(pending);
    }
  }

  await Promise.all(pending);

  const totalTimeMs = performance.now() - startTime;
  const opsPerSecond = (completed / totalTimeMs) * 1000;

  if (errorCount > 0) {
    console.warn(`  [measureThroughput] ${errorCount} errors occurred during measurement`);
  }

  return { opsPerSecond, totalTimeMs, errorCount };
}
