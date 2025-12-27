/**
 * Memory tracking and leak detection for benchmarks
 */

import { forceGC, isGCAvailable, delay, formatBytes } from "./utils.js";

export interface MemorySnapshot {
  timestamp: number;
  rss: number;
  heapTotal: number;
  heapUsed: number;
  external: number;
  arrayBuffers: number;
}

export interface MemoryLeakReport {
  detected: boolean;
  confidence: "low" | "medium" | "high";
  heapGrowthBytes: number;
  heapGrowthPercent: number;
  snapshots: MemorySnapshot[];
  analysis: string;
}

export interface MemoryTrackerOptions {
  /** Interval between snapshots in ms */
  snapshotIntervalMs?: number;
  /** Force GC before each snapshot */
  forceGCBeforeSnapshot?: boolean;
  /** Threshold for leak detection (heap growth %) */
  leakThresholdPercent?: number;
  /** Minimum snapshots needed for leak detection */
  minSnapshotsForLeakDetection?: number;
}

const DEFAULT_OPTIONS: Required<MemoryTrackerOptions> = {
  snapshotIntervalMs: 1000,
  forceGCBeforeSnapshot: true,
  leakThresholdPercent: 20,
  minSnapshotsForLeakDetection: 5,
};

export class MemoryTracker {
  private options: Required<MemoryTrackerOptions>;
  private snapshots: MemorySnapshot[] = [];
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private isTracking = false;

  constructor(options: MemoryTrackerOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /** Take a single memory snapshot */
  takeSnapshot(): MemorySnapshot {
    if (this.options.forceGCBeforeSnapshot) {
      forceGC();
    }

    const mem = process.memoryUsage();
    const snapshot: MemorySnapshot = {
      timestamp: Date.now(),
      rss: mem.rss,
      heapTotal: mem.heapTotal,
      heapUsed: mem.heapUsed,
      external: mem.external,
      arrayBuffers: mem.arrayBuffers,
    };

    this.snapshots.push(snapshot);
    return snapshot;
  }

  /** Start continuous memory tracking */
  startTracking(): void {
    if (this.isTracking) return;

    this.isTracking = true;
    this.snapshots = [];
    this.takeSnapshot(); // Initial snapshot

    this.intervalId = setInterval(() => {
      this.takeSnapshot();
    }, this.options.snapshotIntervalMs);
  }

  /** Stop continuous memory tracking */
  stopTracking(): void {
    if (!this.isTracking) return;

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    this.takeSnapshot(); // Final snapshot
    this.isTracking = false;
  }

  /** Get all snapshots */
  getSnapshots(): MemorySnapshot[] {
    return [...this.snapshots];
  }

  /** Analyze memory for leaks */
  analyzeLeaks(): MemoryLeakReport {
    const snapshots = this.getSnapshots();

    if (snapshots.length < this.options.minSnapshotsForLeakDetection) {
      return {
        detected: false,
        confidence: "low",
        heapGrowthBytes: 0,
        heapGrowthPercent: 0,
        snapshots,
        analysis: `Insufficient snapshots (${snapshots.length}/${this.options.minSnapshotsForLeakDetection}) for leak detection`,
      };
    }

    const firstSnapshot = snapshots[0];
    const lastSnapshot = snapshots[snapshots.length - 1];

    const heapGrowthBytes = lastSnapshot.heapUsed - firstSnapshot.heapUsed;
    const heapGrowthPercent =
      (heapGrowthBytes / firstSnapshot.heapUsed) * 100;

    // Check for continuous growth pattern
    let consecutiveGrowth = 0;
    let maxConsecutiveGrowth = 0;

    for (let i = 1; i < snapshots.length; i++) {
      if (snapshots[i].heapUsed > snapshots[i - 1].heapUsed) {
        consecutiveGrowth++;
        maxConsecutiveGrowth = Math.max(maxConsecutiveGrowth, consecutiveGrowth);
      } else {
        consecutiveGrowth = 0;
      }
    }

    // Determine if leak is detected and confidence level
    const growthRatio = maxConsecutiveGrowth / (snapshots.length - 1);
    let detected = false;
    let confidence: "low" | "medium" | "high" = "low";
    let analysis = "";

    if (heapGrowthPercent > this.options.leakThresholdPercent) {
      detected = true;

      if (growthRatio > 0.8 && heapGrowthPercent > 50) {
        confidence = "high";
        analysis = `Strong leak pattern detected. Heap grew ${heapGrowthPercent.toFixed(1)}% with ${(growthRatio * 100).toFixed(0)}% consecutive growth snapshots.`;
      } else if (growthRatio > 0.5 || heapGrowthPercent > 30) {
        confidence = "medium";
        analysis = `Possible memory leak. Heap grew ${heapGrowthPercent.toFixed(1)}% (${formatBytes(heapGrowthBytes)}). Consider investigating object retention.`;
      } else {
        confidence = "low";
        analysis = `Minor heap growth detected (${heapGrowthPercent.toFixed(1)}%). May be normal GC fluctuation.`;
      }
    } else {
      analysis = `No significant memory leak detected. Heap change: ${heapGrowthPercent.toFixed(1)}% (${formatBytes(heapGrowthBytes)})`;
    }

    return {
      detected,
      confidence,
      heapGrowthBytes,
      heapGrowthPercent,
      snapshots,
      analysis,
    };
  }

  /** Reset tracker state */
  reset(): void {
    this.stopTracking();
    this.snapshots = [];
  }

  /** Run a function with memory tracking */
  async track<T>(fn: () => Promise<T>): Promise<{ result: T; report: MemoryLeakReport }> {
    this.startTracking();
    try {
      const result = await fn();
      return { result, report: this.analyzeLeaks() };
    } finally {
      this.stopTracking();
    }
  }
}

/** Quick memory check - run function multiple times and check for growth */
export async function checkForMemoryLeaks(
  fn: () => Promise<void>,
  options: {
    iterations?: number;
    warmupIterations?: number;
    delayBetweenIterationsMs?: number;
  } = {}
): Promise<MemoryLeakReport> {
  const {
    iterations = 100,
    warmupIterations = 10,
    delayBetweenIterationsMs = 10,
  } = options;

  // Warmup
  for (let i = 0; i < warmupIterations; i++) {
    await fn();
  }

  forceGC();
  await delay(100);

  const tracker = new MemoryTracker({
    snapshotIntervalMs: 100,
    forceGCBeforeSnapshot: false, // Don't GC during test
    minSnapshotsForLeakDetection: 3,
  });

  tracker.takeSnapshot();

  // Run iterations
  const snapshotEvery = Math.max(1, Math.floor(iterations / 10));

  for (let i = 0; i < iterations; i++) {
    await fn();

    if (i % snapshotEvery === 0) {
      forceGC();
      await delay(delayBetweenIterationsMs);
      tracker.takeSnapshot();
    }
  }

  forceGC();
  await delay(100);
  tracker.takeSnapshot();

  return tracker.analyzeLeaks();
}

/** Get GC availability status message */
export function getGCStatus(): string {
  if (isGCAvailable()) {
    return "GC available - accurate memory measurements enabled";
  }
  return "GC not available - run with --expose-gc for accurate memory measurements";
}
