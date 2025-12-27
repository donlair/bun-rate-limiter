#!/usr/bin/env bun
/**
 * Run the full benchmark suite
 *
 * This script runs all benchmark scenarios with various configurations
 * and produces a comprehensive report.
 *
 * Usage:
 *   bun run benchmarks/run-all.ts [options]
 *
 * Options:
 *   --quick           Run quick benchmarks (fewer operations)
 *   --full            Run full benchmarks (more operations, longer duration)
 *   --output <file>   Write JSON results to file
 *   --no-memory       Skip memory stress tests
 *   --no-sustained    Skip sustained load tests
 */

import { parseArgs } from "util";
import { runBenchmark } from "./lib/runner.js";
import {
  reportBenchmarkResult,
  reportComparisonTable,
  reportMemoryLeakAnalysis,
} from "./lib/reporters/console.js";
import { JsonReporter } from "./lib/reporters/json.js";
import { getRuntime, forceGC, delay } from "./lib/utils.js";
import { getGCStatus } from "./lib/memory-tracker.js";
import { allLocalConfigs } from "./configs/index.js";
import { createSharedLimiterThroughputBenchmark } from "./scenarios/throughput.js";
import { createSchedulingLatencyBenchmark } from "./scenarios/latency.js";
import { analyzeBurstBehavior } from "./scenarios/burst.js";
import {
  runSustainedLoadTest,
  reportSustainedLoadResults,
} from "./scenarios/sustained.js";
import {
  runMemoryStressTest,
  reportMemoryStressResults,
} from "./scenarios/memory-stress.js";
import {
  runComparisonBenchmark,
  printComparisonResults,
  isPQueueAvailable,
} from "./competitors/p-queue-adapter.js";
import type { BenchmarkMetrics } from "./lib/metrics.js";

interface CliOptions {
  quick: boolean;
  full: boolean;
  output: string | null;
  noMemory: boolean;
  noSustained: boolean;
}

const HELP = `
Run the full benchmark suite

Usage:
  bun run benchmarks/run-all.ts [options]

Options:
  --quick           Run quick benchmarks (fewer operations)
  --full            Run full benchmarks (more operations, longer duration)
  --output, -o      Write JSON results to file
  --no-memory       Skip memory stress tests
  --no-sustained    Skip sustained load tests
`;

function parseCliArgs(): CliOptions {
  try {
    const { values } = parseArgs({
      options: {
        quick: { type: "boolean", default: false },
        full: { type: "boolean", default: false },
        output: { type: "string", short: "o" },
        "no-memory": { type: "boolean", default: false },
        "no-sustained": { type: "boolean", default: false },
      },
    });

    return {
      quick: values.quick as boolean,
      full: values.full as boolean,
      output: (values.output as string) || null,
      noMemory: values["no-memory"] as boolean,
      noSustained: values["no-sustained"] as boolean,
    };
  } catch (error) {
    console.error("Error parsing arguments:", error);
    console.log(HELP);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const options = parseCliArgs();

  // Determine test parameters based on mode
  const params = options.quick
    ? {
        operations: 1000,
        sustainedDurationMs: 5000,
        memoryIterations: 10,
        concurrency: 5,
      }
    : options.full
      ? {
          operations: 50000,
          sustainedDurationMs: 60000,
          memoryIterations: 200,
          concurrency: 20,
        }
      : {
          operations: 10000,
          sustainedDurationMs: 15000,
          memoryIterations: 50,
          concurrency: 10,
        };

  const runtime = getRuntime();
  const jsonReporter = options.output ? new JsonReporter() : null;

  // Print header
  console.log();
  console.log("╔" + "═".repeat(68) + "╗");
  console.log(
    "║" + " bun-rate-limiter Full Benchmark Suite".padEnd(68) + "║"
  );
  console.log("╠" + "═".repeat(68) + "╣");
  console.log(
    "║" + ` Runtime: ${runtime.name} ${runtime.version}`.padEnd(68) + "║"
  );
  console.log(
    "║" +
      ` Mode: ${options.quick ? "Quick" : options.full ? "Full" : "Standard"}`.padEnd(68) +
      "║"
  );
  console.log("║" + ` ${getGCStatus()}`.padEnd(68) + "║");
  console.log("╚" + "═".repeat(68) + "╝");

  const startTime = Date.now();
  const throughputResults: Array<{ name: string; metrics: BenchmarkMetrics }> =
    [];

  // ═══════════════════════════════════════════════════════════════════
  // PHASE 1: Throughput Benchmarks
  // ═══════════════════════════════════════════════════════════════════
  console.log("\n\n▶ PHASE 1: Throughput Benchmarks\n");

  for (const config of allLocalConfigs) {
    console.log(`  Testing: ${config.name}...`);

    const benchmark = createSharedLimiterThroughputBenchmark(config, {
      operations: params.operations,
      concurrency: params.concurrency,
    });

    const result = await runBenchmark(benchmark);
    throughputResults.push({ name: config.name, metrics: result.metrics });

    if (jsonReporter) {
      jsonReporter.addResult(result.name, result.config, result.metrics);
    }

    console.log(
      `    → ${Math.round(result.metrics.throughput.opsPerSecond).toLocaleString()} ops/sec`
    );

    forceGC();
    await delay(500);
  }

  // Print comparison table
  reportComparisonTable(throughputResults);

  // ═══════════════════════════════════════════════════════════════════
  // PHASE 2: Latency Benchmarks
  // ═══════════════════════════════════════════════════════════════════
  console.log("\n\n▶ PHASE 2: Latency Benchmarks\n");

  // Just test a few key configs for latency
  const latencyConfigs = allLocalConfigs.filter(
    (c) =>
      c.name === "baseline" ||
      c.name === "token-bucket" ||
      c.name === "full-composition"
  );

  for (const config of latencyConfigs) {
    console.log(`  Testing: ${config.name}...`);

    const benchmark = createSchedulingLatencyBenchmark(config, {
      operations: Math.min(params.operations, 5000),
      concurrency: params.concurrency,
    });

    const result = await runBenchmark(benchmark);

    console.log(
      `    → p50: ${result.metrics.latency.p50.toFixed(3)}ms, p99: ${result.metrics.latency.p99.toFixed(3)}ms`
    );

    forceGC();
    await delay(300);
  }

  // ═══════════════════════════════════════════════════════════════════
  // PHASE 3: Burst Handling
  // ═══════════════════════════════════════════════════════════════════
  console.log("\n\n▶ PHASE 3: Burst Handling\n");

  const burstConfigs = allLocalConfigs.filter(
    (c) =>
      c.name === "baseline" ||
      c.name === "token-bucket" ||
      c.name === "api-rate-limit"
  );

  for (const config of burstConfigs) {
    console.log(`  Testing: ${config.name}...`);

    const analysis = await analyzeBurstBehavior(config, {
      burstSize: 50,
      burstCount: 5,
      burstIntervalMs: 300,
      concurrency: params.concurrency,
    });

    console.log(
      `    → Peak queue: ${analysis.overall.peakQueueSize}, Throughput: ${Math.round(analysis.overall.avgThroughput)} ops/sec`
    );

    forceGC();
    await delay(300);
  }

  // ═══════════════════════════════════════════════════════════════════
  // PHASE 4: Sustained Load (optional)
  // ═══════════════════════════════════════════════════════════════════
  if (!options.noSustained) {
    console.log("\n\n▶ PHASE 4: Sustained Load Tests\n");

    const sustainedConfigs = allLocalConfigs.filter(
      (c) => c.name === "baseline" || c.name === "token-bucket-high"
    );

    for (const config of sustainedConfigs) {
      console.log(`  Testing: ${config.name} (${params.sustainedDurationMs / 1000}s)...`);

      const report = await runSustainedLoadTest(config, {
        durationMs: params.sustainedDurationMs,
        targetOpsPerSecond: 500,
        concurrency: params.concurrency,
        reportIntervalMs: Math.max(1000, params.sustainedDurationMs / 5),
      });

      console.log(
        `    → Avg: ${Math.round(report.summary.avgOpsPerSecond)} ops/sec, Stability: ${(report.summary.stabilityScore * 100).toFixed(1)}%`
      );

      forceGC();
      await delay(500);
    }
  } else {
    console.log("\n\n▶ PHASE 4: Sustained Load Tests (SKIPPED)\n");
  }

  // ═══════════════════════════════════════════════════════════════════
  // PHASE 5: Memory Stress Tests (optional)
  // ═══════════════════════════════════════════════════════════════════
  if (!options.noMemory) {
    console.log("\n\n▶ PHASE 5: Memory Stress Tests\n");

    const memoryConfigs = allLocalConfigs.filter(
      (c) => c.name === "baseline" || c.name === "full-composition"
    );

    for (const config of memoryConfigs) {
      console.log(`  Testing: ${config.name}...`);

      const report = await runMemoryStressTest(config, {
        iterations: params.memoryIterations,
        tasksPerIteration: 100,
        concurrency: params.concurrency,
      });

      const status = report.leakReport.detected
        ? `⚠ LEAK (${report.leakReport.confidence})`
        : "✓ No leak";

      console.log(
        `    → ${status}, Heap growth: ${(report.leakReport.heapGrowthPercent).toFixed(1)}%`
      );

      forceGC();
      await delay(500);
    }
  } else {
    console.log("\n\n▶ PHASE 5: Memory Stress Tests (SKIPPED)\n");
  }

  // ═══════════════════════════════════════════════════════════════════
  // PHASE 6: Competitor Comparison
  // ═══════════════════════════════════════════════════════════════════
  console.log("\n\n▶ PHASE 6: p-queue Comparison\n");

  const pQueueAvailable = await isPQueueAvailable();

  if (pQueueAvailable) {
    console.log("  Running comparison...");

    const comparison = await runComparisonBenchmark({
      operations: params.operations,
      concurrency: params.concurrency,
    });

    printComparisonResults(comparison);
  } else {
    console.log("  p-queue not installed, skipping comparison");
    console.log("  Install with: npm install p-queue");
  }

  // ═══════════════════════════════════════════════════════════════════
  // Summary
  // ═══════════════════════════════════════════════════════════════════
  const totalTime = (Date.now() - startTime) / 1000;

  console.log("\n");
  console.log("╔" + "═".repeat(68) + "╗");
  console.log("║" + " Benchmark Suite Complete".padEnd(68) + "║");
  console.log("╠" + "═".repeat(68) + "╣");
  console.log("║" + ` Total time: ${totalTime.toFixed(1)}s`.padEnd(68) + "║");
  console.log(
    "║" + ` Configurations tested: ${allLocalConfigs.length}`.padEnd(68) + "║"
  );

  // Find fastest config
  if (throughputResults.length > 0) {
    const fastest = throughputResults.reduce((a, b) =>
      a.metrics.throughput.opsPerSecond > b.metrics.throughput.opsPerSecond
        ? a
        : b
    );
    console.log(
      "║" +
        ` Fastest config: ${fastest.name} (${Math.round(fastest.metrics.throughput.opsPerSecond).toLocaleString()} ops/sec)`.padEnd(
          68
        ) +
        "║"
    );
  }

  console.log("╚" + "═".repeat(68) + "╝");

  // Write JSON output if requested
  if (jsonReporter && options.output) {
    await jsonReporter.writeToFile(options.output);
    console.log(`\nResults written to: ${options.output}`);
  }
}

main().catch((error) => {
  console.error("Benchmark suite failed:", error);
  process.exit(1);
});
