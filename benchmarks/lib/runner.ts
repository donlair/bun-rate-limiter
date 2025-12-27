/**
 * Core benchmark runner
 */

import { MetricsCollector, Timer, type BenchmarkMetrics } from "./metrics.js";
import { MemoryTracker, type MemoryLeakReport } from "./memory-tracker.js";
import { forceGC, delay, getRuntime } from "./utils.js";
import { reportProgress } from "./reporters/console.js";

export interface BenchmarkOptions {
  /** Number of operations to run */
  operations?: number;
  /** Number of warmup operations */
  warmupOperations?: number;
  /** Maximum duration in ms (overrides operations if reached first) */
  maxDurationMs?: number;
  /** Concurrency level */
  concurrency?: number;
  /** Whether to track memory during the benchmark */
  trackMemory?: boolean;
  /** Whether to detect memory leaks */
  detectLeaks?: boolean;
  /** Memory snapshot interval in ms */
  memorySnapshotIntervalMs?: number;
  /** Show progress bar */
  showProgress?: boolean;
  /** Label for progress bar */
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
    // Warmup phase
    if (options.warmupOperations > 0) {
      for (let i = 0; i < options.warmupOperations; i++) {
        await fn({ operationIndex: i });
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
    // Cleanup
    if (cleanup) {
      await cleanup();
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
): Promise<{ opsPerSecond: number; totalTimeMs: number }> {
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

  while (completed < operations) {
    while (pending.length < concurrency && completed + pending.length < operations) {
      const promise = fn().then(() => {
        completed++;
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
  const opsPerSecond = (operations / totalTimeMs) * 1000;

  return { opsPerSecond, totalTimeMs };
}
