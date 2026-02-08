/**
 * Metrics collection and statistical analysis for benchmarks
 */

import { now } from "./utils.js";

export interface LatencyStats {
  count: number;
  min: number;
  max: number;
  mean: number;
  stddev: number;
  p50: number;
  p75: number;
  p90: number;
  p95: number;
  p99: number;
  p999: number;
}

export interface ThroughputStats {
  totalOperations: number;
  totalTimeMs: number;
  opsPerSecond: number;
  avgTimePerOp: number;
}

export interface MemoryStats {
  rss: number;
  heapTotal: number;
  heapUsed: number;
  external: number;
  arrayBuffers: number;
}

export interface BenchmarkMetrics {
  latency: LatencyStats;
  throughput: ThroughputStats;
  memory: {
    start: MemoryStats;
    end: MemoryStats;
    delta: MemoryStats;
    peakHeapUsed: number;
  };
  errors: number;
  timeouts: number;
}

/**
 * Histogram for collecting and analyzing latency samples.
 * Provides statistical analysis including percentiles, mean, and standard deviation.
 */
export class Histogram {
  private samples: number[] = [];
  private sorted = false;

  /**
   * Add a single sample value to the histogram
   * @param value - The sample value to add (typically in milliseconds)
   */
  add(value: number): void {
    this.samples.push(value);
    this.sorted = false;
  }

  /**
   * Add multiple sample values to the histogram
   * @param values - Array of sample values to add
   */
  addAll(values: number[]): void {
    this.samples.push(...values);
    this.sorted = false;
  }

  private ensureSorted(): void {
    if (!this.sorted) {
      this.samples.sort((a, b) => a - b);
      this.sorted = true;
    }
  }

  /** Number of samples in the histogram */
  get count(): number {
    return this.samples.length;
  }

  /** Minimum sample value, or 0 if empty */
  get min(): number {
    if (this.samples.length === 0) return 0;
    this.ensureSorted();
    return this.samples[0];
  }

  /** Maximum sample value, or 0 if empty */
  get max(): number {
    if (this.samples.length === 0) return 0;
    this.ensureSorted();
    return this.samples[this.samples.length - 1];
  }

  /** Arithmetic mean of all samples, or 0 if empty */
  get mean(): number {
    if (this.samples.length === 0) return 0;
    return this.samples.reduce((a, b) => a + b, 0) / this.samples.length;
  }

  /** Sample standard deviation, or 0 if fewer than 2 samples */
  get stddev(): number {
    if (this.samples.length < 2) return 0;
    const mean = this.mean;
    const squaredDiffs = this.samples.map((x) => (x - mean) ** 2);
    return Math.sqrt(
      squaredDiffs.reduce((a, b) => a + b, 0) / (this.samples.length - 1)
    );
  }

  /**
   * Get the value at a given percentile
   * @param p - Percentile (0-100), e.g., 50 for median, 99 for p99
   * @returns The value at the given percentile, or 0 if histogram is empty
   */
  percentile(p: number): number {
    if (this.samples.length === 0) return 0;
    this.ensureSorted();
    const index = Math.ceil((p / 100) * this.samples.length) - 1;
    return this.samples[Math.max(0, Math.min(index, this.samples.length - 1))];
  }

  /**
   * Get comprehensive statistics for all samples
   * @returns LatencyStats object with count, min, max, mean, stddev, and percentiles
   */
  getStats(): LatencyStats {
    return {
      count: this.count,
      min: this.min,
      max: this.max,
      mean: this.mean,
      stddev: this.stddev,
      p50: this.percentile(50),
      p75: this.percentile(75),
      p90: this.percentile(90),
      p95: this.percentile(95),
      p99: this.percentile(99),
      p999: this.percentile(99.9),
    };
  }

  /** Clear all samples from the histogram */
  reset(): void {
    this.samples = [];
    this.sorted = false;
  }
}

/** Collects metrics during benchmark execution */
export class MetricsCollector {
  private latencyHistogram = new Histogram();
  private startTime = 0;
  private endTime = 0;
  private startMemory: MemoryStats | null = null;
  private endMemory: MemoryStats | null = null;
  private peakHeapUsed = 0;
  private errorCount = 0;
  private timeoutCount = 0;
  private operationCount = 0;

  /** Start timing the benchmark */
  start(): void {
    this.startTime = now();
    this.startMemory = this.captureMemory();
    this.peakHeapUsed = this.startMemory.heapUsed;
  }

  /** Stop timing the benchmark */
  stop(): void {
    this.endTime = now();
    this.endMemory = this.captureMemory();
  }

  /** Record a latency sample */
  recordLatency(durationMs: number): void {
    this.latencyHistogram.add(durationMs);
    this.operationCount++;
  }

  /** Record an error */
  recordError(): void {
    this.errorCount++;
  }

  /** Record a timeout */
  recordTimeout(): void {
    this.timeoutCount++;
  }

  /** Update peak memory if current is higher */
  updatePeakMemory(): void {
    const current = process.memoryUsage().heapUsed;
    if (current > this.peakHeapUsed) {
      this.peakHeapUsed = current;
    }
  }

  /** Capture current memory stats */
  private captureMemory(): MemoryStats {
    const mem = process.memoryUsage();
    return {
      rss: mem.rss,
      heapTotal: mem.heapTotal,
      heapUsed: mem.heapUsed,
      external: mem.external,
      arrayBuffers: mem.arrayBuffers,
    };
  }

  /** Get final metrics */
  getMetrics(): BenchmarkMetrics {
    const totalTimeMs = this.endTime - this.startTime;
    const start = this.startMemory || this.captureMemory();
    const end = this.endMemory || this.captureMemory();

    return {
      latency: this.latencyHistogram.getStats(),
      throughput: {
        totalOperations: this.operationCount,
        totalTimeMs,
        opsPerSecond:
          totalTimeMs > 0 ? (this.operationCount / totalTimeMs) * 1000 : 0,
        avgTimePerOp:
          this.operationCount > 0 ? totalTimeMs / this.operationCount : 0,
      },
      memory: {
        start,
        end,
        delta: {
          rss: end.rss - start.rss,
          heapTotal: end.heapTotal - start.heapTotal,
          heapUsed: end.heapUsed - start.heapUsed,
          external: end.external - start.external,
          arrayBuffers: end.arrayBuffers - start.arrayBuffers,
        },
        peakHeapUsed: this.peakHeapUsed,
      },
      errors: this.errorCount,
      timeouts: this.timeoutCount,
    };
  }

  /** Reset all metrics */
  reset(): void {
    this.latencyHistogram.reset();
    this.startTime = 0;
    this.endTime = 0;
    this.startMemory = null;
    this.endMemory = null;
    this.peakHeapUsed = 0;
    this.errorCount = 0;
    this.timeoutCount = 0;
    this.operationCount = 0;
  }
}

/** Timer utility for measuring individual operations */
export class Timer {
  private startTime = 0;

  start(): void {
    this.startTime = now();
  }

  stop(): number {
    return now() - this.startTime;
  }

  static measure<T>(fn: () => T): { result: T; durationMs: number } {
    const start = now();
    const result = fn();
    return { result, durationMs: now() - start };
  }

  static async measureAsync<T>(
    fn: () => Promise<T>
  ): Promise<{ result: T; durationMs: number }> {
    const start = now();
    const result = await fn();
    return { result, durationMs: now() - start };
  }
}
