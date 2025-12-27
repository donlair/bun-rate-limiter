/**
 * JSON reporter for benchmark results
 */

import type { BenchmarkMetrics } from "../metrics.js";
import type { MemoryLeakReport } from "../memory-tracker.js";
import { getRuntime } from "../utils.js";

export interface BenchmarkReport {
  metadata: {
    timestamp: string;
    runtime: { name: string; version: string };
    platform: string;
    cpus: number;
    totalMemory: number;
  };
  results: BenchmarkResultEntry[];
  summary?: {
    fastest: string;
    slowest: string;
    mostMemoryEfficient: string;
  };
}

export interface BenchmarkResultEntry {
  name: string;
  config: string;
  metrics: BenchmarkMetrics;
  memoryLeakReport?: MemoryLeakReport;
}

export class JsonReporter {
  private results: BenchmarkResultEntry[] = [];

  /** Add a benchmark result */
  addResult(
    name: string,
    config: string,
    metrics: BenchmarkMetrics,
    memoryLeakReport?: MemoryLeakReport
  ): void {
    this.results.push({ name, config, metrics, memoryLeakReport });
  }

  /** Generate the full report */
  generateReport(): BenchmarkReport {
    const runtime = getRuntime();
    const os = require("os");

    const report: BenchmarkReport = {
      metadata: {
        timestamp: new Date().toISOString(),
        runtime,
        platform: `${os.platform()} ${os.release()} (${os.arch()})`,
        cpus: os.cpus().length,
        totalMemory: os.totalmem(),
      },
      results: this.results,
    };

    // Add summary if we have results
    if (this.results.length > 0) {
      const sorted = [...this.results].sort(
        (a, b) =>
          b.metrics.throughput.opsPerSecond - a.metrics.throughput.opsPerSecond
      );

      const memSorted = [...this.results].sort(
        (a, b) =>
          a.metrics.memory.delta.heapUsed - b.metrics.memory.delta.heapUsed
      );

      report.summary = {
        fastest: sorted[0].name,
        slowest: sorted[sorted.length - 1].name,
        mostMemoryEfficient: memSorted[0].name,
      };
    }

    return report;
  }

  /** Export report as JSON string */
  toJSON(pretty = true): string {
    const report = this.generateReport();
    return JSON.stringify(report, null, pretty ? 2 : 0);
  }

  /** Write report to file */
  async writeToFile(filepath: string): Promise<void> {
    const json = this.toJSON();
    const fs = await import("fs/promises");
    await fs.writeFile(filepath, json, "utf-8");
  }

  /** Reset reporter */
  reset(): void {
    this.results = [];
  }
}

/** Convert metrics to a simpler format for quick comparison */
export function metricsToSummary(metrics: BenchmarkMetrics): {
  opsPerSecond: number;
  latencyP50Ms: number;
  latencyP99Ms: number;
  heapDeltaBytes: number;
  errors: number;
} {
  return {
    opsPerSecond: Math.round(metrics.throughput.opsPerSecond),
    latencyP50Ms: Number(metrics.latency.p50.toFixed(3)),
    latencyP99Ms: Number(metrics.latency.p99.toFixed(3)),
    heapDeltaBytes: metrics.memory.delta.heapUsed,
    errors: metrics.errors + metrics.timeouts,
  };
}
