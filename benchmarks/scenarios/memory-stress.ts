/**
 * Memory stress benchmark scenario
 * Tests memory behavior under pressure and detects leaks
 */

import { RateLimiter } from "../../src/index.js";
import { now, delay, forceGC, formatBytes } from "../lib/utils.js";
import type { RateLimiterConfig } from "../configs/types.js";
import {
  MemoryTracker,
  checkForMemoryLeaks,
  type MemoryLeakReport,
} from "../lib/memory-tracker.js";

export interface MemoryStressOptions {
  /** Number of iterations */
  iterations?: number;
  /** Tasks per iteration */
  tasksPerIteration?: number;
  /** Concurrency level */
  concurrency?: number;
  /** Size of data allocated per task (bytes) */
  allocationSizePerTask?: number;
  /** Whether to hold references (simulate leak) */
  holdReferences?: boolean;
}

const DEFAULT_OPTIONS: Required<MemoryStressOptions> = {
  iterations: 100,
  tasksPerIteration: 100,
  concurrency: 10,
  allocationSizePerTask: 1024, // 1KB
  holdReferences: false,
};

export interface MemoryStressReport {
  iterations: number;
  totalTasks: number;
  totalAllocated: number;
  leakReport: MemoryLeakReport;
  gcStats: {
    gcAvailable: boolean;
    preTestHeap: number;
    postTestHeap: number;
    peakHeap: number;
    finalHeapAfterGC: number;
  };
  timing: {
    totalTimeMs: number;
    avgIterationTimeMs: number;
  };
}

/**
 * Run memory stress test
 */
export async function runMemoryStressTest(
  config: RateLimiterConfig,
  options: MemoryStressOptions = {}
): Promise<MemoryStressReport> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  const tracker = new MemoryTracker({
    snapshotIntervalMs: 500,
    forceGCBeforeSnapshot: true,
    leakThresholdPercent: 15,
    minSnapshotsForLeakDetection: 5,
  });

  // Pre-test GC
  forceGC();
  await delay(100);

  const preTestHeap = process.memoryUsage().heapUsed;
  let peakHeap = preTestHeap;

  const heldReferences: Buffer[] = [];
  const startTime = now();

  tracker.startTracking();

  for (let iteration = 0; iteration < opts.iterations; iteration++) {
    const limiter = new RateLimiter({
      concurrency: opts.concurrency,
      ...config.options,
    });

    const promises: Promise<void>[] = [];

    for (let i = 0; i < opts.tasksPerIteration; i++) {
      const promise = limiter.add(async () => {
        // Allocate some memory
        const buffer = Buffer.alloc(opts.allocationSizePerTask);

        // Fill with data to ensure it's actually allocated
        buffer.fill(i % 256);

        if (opts.holdReferences) {
          heldReferences.push(buffer);
        }

        await delay(0);

        // Return something to prevent optimization from eliminating allocation
        return buffer.length;
      });

      promises.push(promise);
    }

    await Promise.all(promises);
    limiter.clear();

    // Track peak memory
    const currentHeap = process.memoryUsage().heapUsed;
    if (currentHeap > peakHeap) {
      peakHeap = currentHeap;
    }

    // Periodic GC to simulate real-world conditions
    if (iteration % 10 === 0) {
      forceGC();
      await delay(10);
    }
  }

  tracker.stopTracking();

  const totalTimeMs = now() - startTime;

  // Final cleanup
  forceGC();
  await delay(100);

  const postTestHeap = process.memoryUsage().heapUsed;

  forceGC();
  await delay(100);

  const finalHeapAfterGC = process.memoryUsage().heapUsed;

  // Clear held references if any
  heldReferences.length = 0;

  return {
    iterations: opts.iterations,
    totalTasks: opts.iterations * opts.tasksPerIteration,
    totalAllocated: opts.iterations * opts.tasksPerIteration * opts.allocationSizePerTask,
    leakReport: tracker.analyzeLeaks(),
    gcStats: {
      gcAvailable: typeof global.gc === "function" || typeof Bun !== "undefined",
      preTestHeap,
      postTestHeap,
      peakHeap,
      finalHeapAfterGC,
    },
    timing: {
      totalTimeMs,
      avgIterationTimeMs: totalTimeMs / opts.iterations,
    },
  };
}

/**
 * Quick memory leak check for a configuration
 */
export async function quickLeakCheck(
  config: RateLimiterConfig,
  options: {
    operations?: number;
    concurrency?: number;
  } = {}
): Promise<MemoryLeakReport> {
  const { operations = 10000, concurrency = 10 } = options;

  return checkForMemoryLeaks(
    async () => {
      const limiter = new RateLimiter({
        concurrency,
        ...config.options,
      });

      const promises: Promise<void>[] = [];
      for (let i = 0; i < 100; i++) {
        promises.push(
          limiter.add(async () => {
            await delay(0);
          })
        );
      }

      await Promise.all(promises);
      limiter.clear();
    },
    {
      iterations: Math.floor(operations / 100),
      warmupIterations: 10,
      delayBetweenIterationsMs: 5,
    }
  );
}

/**
 * Test limiter instance lifecycle (create/destroy)
 */
export async function testLimiterLifecycle(
  config: RateLimiterConfig,
  options: {
    iterations?: number;
    tasksPerLimiter?: number;
  } = {}
): Promise<{
  iterations: number;
  heapGrowthBytes: number;
  heapGrowthPercent: number;
  avgCreateTimeMs: number;
  avgDestroyTimeMs: number;
  leakDetected: boolean;
}> {
  const { iterations = 100, tasksPerLimiter = 50 } = options;

  forceGC();
  await delay(100);
  const startHeap = process.memoryUsage().heapUsed;

  const createTimes: number[] = [];
  const destroyTimes: number[] = [];

  for (let i = 0; i < iterations; i++) {
    const createStart = now();
    const limiter = new RateLimiter({
      concurrency: 5,
      ...config.options,
    });
    createTimes.push(now() - createStart);

    // Use the limiter
    const promises: Promise<void>[] = [];
    for (let j = 0; j < tasksPerLimiter; j++) {
      promises.push(
        limiter.add(async () => {
          await delay(0);
        })
      );
    }
    await Promise.all(promises);

    const destroyStart = now();
    limiter.clear();
    destroyTimes.push(now() - destroyStart);

    // Periodic GC
    if (i % 20 === 0) {
      forceGC();
      await delay(10);
    }
  }

  forceGC();
  await delay(100);
  const endHeap = process.memoryUsage().heapUsed;

  const heapGrowthBytes = endHeap - startHeap;
  const heapGrowthPercent = (heapGrowthBytes / startHeap) * 100;

  return {
    iterations,
    heapGrowthBytes,
    heapGrowthPercent,
    avgCreateTimeMs:
      createTimes.reduce((a, b) => a + b, 0) / createTimes.length,
    avgDestroyTimeMs:
      destroyTimes.reduce((a, b) => a + b, 0) / destroyTimes.length,
    leakDetected: heapGrowthPercent > 20,
  };
}

/**
 * Report memory stress results to console
 */
export function reportMemoryStressResults(
  name: string,
  report: MemoryStressReport
): void {
  console.log();
  console.log("═".repeat(70));
  console.log(` Memory Stress Test: ${name}`);
  console.log("═".repeat(70));

  console.log(" Test Parameters:");
  console.log(`   Iterations:      ${report.iterations}`);
  console.log(`   Total tasks:     ${report.totalTasks.toLocaleString()}`);
  console.log(`   Total allocated: ${formatBytes(report.totalAllocated)}`);
  console.log(`   Total time:      ${(report.timing.totalTimeMs / 1000).toFixed(2)}s`);

  console.log();
  console.log(" Memory Stats:");
  console.log(`   GC available:    ${report.gcStats.gcAvailable ? "Yes" : "No"}`);
  console.log(`   Pre-test heap:   ${formatBytes(report.gcStats.preTestHeap)}`);
  console.log(`   Peak heap:       ${formatBytes(report.gcStats.peakHeap)}`);
  console.log(`   Post-test heap:  ${formatBytes(report.gcStats.postTestHeap)}`);
  console.log(`   After GC heap:   ${formatBytes(report.gcStats.finalHeapAfterGC)}`);

  console.log();
  console.log(" Leak Analysis:");
  const lr = report.leakReport;
  const statusColor = lr.detected
    ? lr.confidence === "high"
      ? "\x1b[31m"
      : "\x1b[33m"
    : "\x1b[32m";
  const resetColor = "\x1b[0m";

  console.log(
    `   Status:          ${statusColor}${lr.detected ? `LEAK DETECTED (${lr.confidence})` : "NO LEAK"}${resetColor}`
  );
  console.log(`   Heap growth:     ${formatBytes(lr.heapGrowthBytes)} (${lr.heapGrowthPercent.toFixed(1)}%)`);
  console.log(`   Analysis:        ${lr.analysis}`);

  console.log("═".repeat(70));
  console.log();
}
