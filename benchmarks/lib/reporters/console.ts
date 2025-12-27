/**
 * Console reporter for benchmark results
 */

import type { BenchmarkMetrics } from "../metrics.js";
import type { MemoryLeakReport } from "../memory-tracker.js";
import { formatBytes, formatNumber, formatDuration, getRuntime } from "../utils.js";

export interface ConsoleReporterOptions {
  /** Show detailed latency percentiles */
  showDetailedLatency?: boolean;
  /** Show memory breakdown */
  showMemoryDetails?: boolean;
  /** Use colors in output */
  useColors?: boolean;
  /** Show comparison with baseline */
  baselineMetrics?: BenchmarkMetrics;
}

const COLORS = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
};

function color(text: string, colorCode: string, useColors: boolean): string {
  return useColors ? `${colorCode}${text}${COLORS.reset}` : text;
}

function line(char: string, length: number): string {
  return char.repeat(length);
}

export function reportBenchmarkResult(
  name: string,
  config: string,
  metrics: BenchmarkMetrics,
  options: ConsoleReporterOptions = {}
): void {
  const {
    showDetailedLatency = true,
    showMemoryDetails = true,
    useColors = true,
    baselineMetrics,
  } = options;

  const runtime = getRuntime();
  const width = 70;

  console.log();
  console.log(color(line("═", width), COLORS.bold, useColors));
  console.log(
    color(` ${name}`, COLORS.bold + COLORS.cyan, useColors) +
    color(` (${runtime.name} ${runtime.version})`, COLORS.dim, useColors)
  );
  console.log(color(line("═", width), COLORS.bold, useColors));

  // Configuration
  console.log(color(" Configuration:", COLORS.bold, useColors));
  console.log(`   ${config}`);
  console.log(color(line("─", width), COLORS.dim, useColors));

  // Throughput
  console.log(color(" Throughput:", COLORS.bold, useColors));
  const opsPerSec = formatNumber(Math.round(metrics.throughput.opsPerSecond));
  console.log(`   Operations:     ${formatNumber(metrics.throughput.totalOperations)}`);
  console.log(`   Total time:     ${formatDuration(metrics.throughput.totalTimeMs)}`);
  console.log(
    color(`   Ops/sec:        ${opsPerSec}`, COLORS.green, useColors)
  );

  if (baselineMetrics) {
    const diff = metrics.throughput.opsPerSecond - baselineMetrics.throughput.opsPerSecond;
    const diffPercent = (diff / baselineMetrics.throughput.opsPerSecond) * 100;
    const diffColor = diff > 0 ? COLORS.green : COLORS.red;
    console.log(
      color(
        `   vs baseline:    ${diff > 0 ? "+" : ""}${diffPercent.toFixed(1)}%`,
        diffColor,
        useColors
      )
    );
  }

  console.log(color(line("─", width), COLORS.dim, useColors));

  // Latency
  console.log(color(" Latency:", COLORS.bold, useColors));
  console.log(`   Min:            ${formatDuration(metrics.latency.min)}`);
  console.log(`   Mean:           ${formatDuration(metrics.latency.mean)}`);
  console.log(`   Max:            ${formatDuration(metrics.latency.max)}`);

  if (showDetailedLatency) {
    console.log(`   Std Dev:        ${formatDuration(metrics.latency.stddev)}`);
    console.log(color("   Percentiles:", COLORS.dim, useColors));
    console.log(`     p50:          ${formatDuration(metrics.latency.p50)}`);
    console.log(`     p75:          ${formatDuration(metrics.latency.p75)}`);
    console.log(`     p90:          ${formatDuration(metrics.latency.p90)}`);
    console.log(`     p95:          ${formatDuration(metrics.latency.p95)}`);
    console.log(`     p99:          ${formatDuration(metrics.latency.p99)}`);
  }

  console.log(color(line("─", width), COLORS.dim, useColors));

  // Memory
  console.log(color(" Memory:", COLORS.bold, useColors));
  console.log(`   Start heap:     ${formatBytes(metrics.memory.start.heapUsed)}`);
  console.log(`   End heap:       ${formatBytes(metrics.memory.end.heapUsed)}`);
  console.log(`   Peak heap:      ${formatBytes(metrics.memory.peakHeapUsed)}`);

  const heapDelta = metrics.memory.delta.heapUsed;
  const deltaColor = heapDelta > 10 * 1024 * 1024 ? COLORS.yellow : COLORS.dim;
  console.log(
    color(
      `   Heap delta:     ${heapDelta >= 0 ? "+" : ""}${formatBytes(heapDelta)}`,
      deltaColor,
      useColors
    )
  );

  if (showMemoryDetails) {
    console.log(`   RSS delta:      ${formatBytes(metrics.memory.delta.rss)}`);
    console.log(`   External delta: ${formatBytes(metrics.memory.delta.external)}`);
  }

  // Errors
  if (metrics.errors > 0 || metrics.timeouts > 0) {
    console.log(color(line("─", width), COLORS.dim, useColors));
    console.log(color(" Errors:", COLORS.bold, useColors));
    if (metrics.errors > 0) {
      console.log(color(`   Errors:         ${metrics.errors}`, COLORS.red, useColors));
    }
    if (metrics.timeouts > 0) {
      console.log(color(`   Timeouts:       ${metrics.timeouts}`, COLORS.yellow, useColors));
    }
  }

  console.log(color(line("═", width), COLORS.bold, useColors));
  console.log();
}

export function reportMemoryLeakAnalysis(
  report: MemoryLeakReport,
  options: { useColors?: boolean } = {}
): void {
  const { useColors = true } = options;
  const width = 70;

  console.log();
  console.log(color(line("═", width), COLORS.bold, useColors));
  console.log(color(" Memory Leak Analysis", COLORS.bold + COLORS.magenta, useColors));
  console.log(color(line("═", width), COLORS.bold, useColors));

  const statusColor = report.detected
    ? report.confidence === "high"
      ? COLORS.red
      : COLORS.yellow
    : COLORS.green;

  const statusText = report.detected
    ? `LEAK DETECTED (${report.confidence} confidence)`
    : "NO LEAK DETECTED";

  console.log(color(` Status: ${statusText}`, statusColor, useColors));
  console.log();
  console.log(` Heap Growth: ${formatBytes(report.heapGrowthBytes)} (${report.heapGrowthPercent.toFixed(1)}%)`);
  console.log(` Snapshots:   ${report.snapshots.length}`);
  console.log();
  console.log(color(" Analysis:", COLORS.bold, useColors));
  console.log(`   ${report.analysis}`);

  console.log(color(line("═", width), COLORS.bold, useColors));
  console.log();
}

export function reportComparisonTable(
  results: Array<{ name: string; metrics: BenchmarkMetrics }>,
  options: { useColors?: boolean; sortBy?: "throughput" | "latency" } = {}
): void {
  const { useColors = true, sortBy = "throughput" } = options;

  // Sort results
  const sorted = [...results].sort((a, b) => {
    if (sortBy === "throughput") {
      return b.metrics.throughput.opsPerSecond - a.metrics.throughput.opsPerSecond;
    }
    return a.metrics.latency.p50 - b.metrics.latency.p50;
  });

  const baseline = sorted[0];
  const width = 80;

  console.log();
  console.log(color(line("═", width), COLORS.bold, useColors));
  console.log(color(" Comparison Results", COLORS.bold + COLORS.cyan, useColors));
  console.log(color(line("═", width), COLORS.bold, useColors));
  console.log();

  // Header
  console.log(
    color(
      " " +
        "Name".padEnd(25) +
        "Ops/sec".padStart(12) +
        "p50".padStart(10) +
        "p99".padStart(10) +
        "Memory".padStart(12) +
        "vs Best".padStart(10),
      COLORS.bold,
      useColors
    )
  );
  console.log(color(" " + line("─", width - 2), COLORS.dim, useColors));

  // Rows
  for (const { name, metrics } of sorted) {
    const opsPerSec = formatNumber(Math.round(metrics.throughput.opsPerSecond));
    const p50 = formatDuration(metrics.latency.p50);
    const p99 = formatDuration(metrics.latency.p99);
    const memory = formatBytes(metrics.memory.delta.heapUsed);

    const diff =
      ((metrics.throughput.opsPerSecond - baseline.metrics.throughput.opsPerSecond) /
        baseline.metrics.throughput.opsPerSecond) *
      100;
    const diffStr = diff === 0 ? "baseline" : `${diff > 0 ? "+" : ""}${diff.toFixed(1)}%`;

    const isFirst = metrics === baseline.metrics;
    const rowColor = isFirst ? COLORS.green : COLORS.white;

    console.log(
      color(
        " " +
          name.padEnd(25) +
          opsPerSec.padStart(12) +
          p50.padStart(10) +
          p99.padStart(10) +
          memory.padStart(12) +
          diffStr.padStart(10),
        rowColor,
        useColors
      )
    );
  }

  console.log(color(line("═", width), COLORS.bold, useColors));
  console.log();
}

export function reportProgress(
  current: number,
  total: number,
  label: string,
  options: { useColors?: boolean } = {}
): void {
  const { useColors = true } = options;
  const percent = Math.round((current / total) * 100);
  const barWidth = 30;
  const filled = Math.round((current / total) * barWidth);
  const empty = barWidth - filled;
  const bar = "█".repeat(filled) + "░".repeat(empty);

  process.stdout.write(
    `\r${color(` ${label}:`, COLORS.dim, useColors)} [${bar}] ${percent}% (${current}/${total})`
  );

  if (current === total) {
    console.log();
  }
}
