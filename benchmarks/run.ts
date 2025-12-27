#!/usr/bin/env bun
/**
 * Main benchmark CLI entry point
 *
 * Usage:
 *   bun run benchmarks/run.ts [options]
 *
 * Options:
 *   --scenario <name>     Run specific scenario (throughput, latency, burst, sustained, memory)
 *   --config <name>       Use specific config (baseline, token-bucket, spacing, etc.)
 *   --operations <n>      Number of operations (default: 10000)
 *   --concurrency <n>     Concurrency level (default: 10)
 *   --compare             Compare with p-queue
 *   --detect-leaks        Enable memory leak detection
 *   --output <file>       Write JSON results to file
 *   --help                Show this help
 *
 * Examples:
 *   bun run benchmarks/run.ts --scenario throughput
 *   bun run benchmarks/run.ts --scenario throughput --config token-bucket --operations 50000
 *   bun run benchmarks/run.ts --compare
 *   bun run benchmarks/run.ts --scenario memory --detect-leaks
 */

import { parseArgs } from "util";
import { runBenchmark, type BenchmarkDefinition } from "./lib/runner.js";
import {
  reportBenchmarkResult,
  reportMemoryLeakAnalysis,
} from "./lib/reporters/console.js";
import { JsonReporter } from "./lib/reporters/json.js";
import { getRuntime, forceGC } from "./lib/utils.js";
import { getGCStatus } from "./lib/memory-tracker.js";
import { allLocalConfigs, getConfigByName } from "./configs/index.js";
import {
  createSharedLimiterThroughputBenchmark,
  findMaxThroughput,
} from "./scenarios/throughput.js";
import {
  createSchedulingLatencyBenchmark,
  analyzeLatencyDistribution,
} from "./scenarios/latency.js";
import {
  createBurstBenchmark,
  analyzeBurstBehavior,
} from "./scenarios/burst.js";
import {
  runSustainedLoadTest,
  reportSustainedLoadResults,
} from "./scenarios/sustained.js";
import {
  runMemoryStressTest,
  quickLeakCheck,
  reportMemoryStressResults,
} from "./scenarios/memory-stress.js";
import {
  runComparisonBenchmark,
  printComparisonResults,
  isPQueueAvailable,
} from "./competitors/p-queue-adapter.js";
import type { RateLimiterConfig } from "./configs/types.js";

const HELP = `
Benchmark CLI for bun-rate-limiter

Usage:
  bun run benchmarks/run.ts [options]

Scenarios:
  throughput    Measure maximum operations per second
  latency       Measure scheduling and execution latency
  burst         Test burst handling performance
  sustained     Test performance under sustained load
  memory        Test memory usage and detect leaks
  compare       Compare with p-queue library
  max-throughput Find maximum sustainable throughput

Configurations:
  baseline              Pure concurrency control (no throttling)
  token-bucket          Token bucket throttler
  token-bucket-high     High-capacity token bucket
  spacing               Minimum delay between tasks
  spacing-tight         Tight spacing (1ms)
  interval              Sliding window rate limit
  interval-high         High-throughput interval
  bucket+spacing        Token bucket + spacing composition
  bucket+interval       Token bucket + interval composition
  spacing+interval      Spacing + interval composition
  full-composition      All throttlers combined
  api-rate-limit        Realistic API rate limiting
  high-throughput-api   High-throughput API scenario

Options:
  --scenario, -s <name>   Scenario to run (default: throughput)
  --config, -c <name>     Configuration to use (default: baseline)
  --operations, -n <n>    Number of operations (default: 10000)
  --concurrency <n>       Concurrency level (default: 10)
  --duration <ms>         Duration for sustained tests (default: 30000)
  --compare               Compare with p-queue
  --detect-leaks          Enable memory leak detection
  --all-configs           Run scenario with all configurations
  --output, -o <file>     Write JSON results to file
  --quiet, -q             Minimal output
  --help, -h              Show this help

Examples:
  bun run benchmarks/run.ts
  bun run benchmarks/run.ts --scenario throughput --config token-bucket
  bun run benchmarks/run.ts --scenario burst --all-configs
  bun run benchmarks/run.ts --scenario memory --detect-leaks
  bun run benchmarks/run.ts --compare --operations 50000
  node --experimental-strip-types benchmarks/run.ts --scenario throughput
`;

interface CliOptions {
  scenario: string;
  config: string;
  operations: number;
  concurrency: number;
  duration: number;
  compare: boolean;
  detectLeaks: boolean;
  allConfigs: boolean;
  output: string | null;
  quiet: boolean;
  help: boolean;
}

function parseCliArgs(): CliOptions {
  try {
    const { values } = parseArgs({
      options: {
        scenario: { type: "string", short: "s", default: "throughput" },
        config: { type: "string", short: "c", default: "baseline" },
        operations: { type: "string", short: "n", default: "10000" },
        concurrency: { type: "string", default: "10" },
        duration: { type: "string", default: "30000" },
        compare: { type: "boolean", default: false },
        "detect-leaks": { type: "boolean", default: false },
        "all-configs": { type: "boolean", default: false },
        output: { type: "string", short: "o" },
        quiet: { type: "boolean", short: "q", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
    });

    return {
      scenario: values.scenario as string,
      config: values.config as string,
      operations: parseInt(values.operations as string, 10),
      concurrency: parseInt(values.concurrency as string, 10),
      duration: parseInt(values.duration as string, 10),
      compare: values.compare as boolean,
      detectLeaks: values["detect-leaks"] as boolean,
      allConfigs: values["all-configs"] as boolean,
      output: (values.output as string) || null,
      quiet: values.quiet as boolean,
      help: values.help as boolean,
    };
  } catch (error) {
    console.error("Error parsing arguments:", error);
    console.log(HELP);
    process.exit(1);
  }
}

async function runScenario(
  scenario: string,
  configs: RateLimiterConfig[],
  options: CliOptions
): Promise<void> {
  const jsonReporter = options.output ? new JsonReporter() : null;

  for (const config of configs) {
    if (!options.quiet) {
      console.log(`\nRunning ${scenario} benchmark with config: ${config.name}`);
    }

    switch (scenario) {
      case "throughput": {
        const benchmark = createSharedLimiterThroughputBenchmark(config, {
          operations: options.operations,
          concurrency: options.concurrency,
        });
        const result = await runBenchmark(benchmark);

        if (!options.quiet) {
          reportBenchmarkResult(result.name, result.config, result.metrics);
        }

        if (jsonReporter) {
          jsonReporter.addResult(
            result.name,
            result.config,
            result.metrics,
            result.memoryLeakReport
          );
        }
        break;
      }

      case "latency": {
        const benchmark = createSchedulingLatencyBenchmark(config, {
          operations: options.operations,
          concurrency: options.concurrency,
        });
        const result = await runBenchmark(benchmark);

        if (!options.quiet) {
          reportBenchmarkResult(result.name, result.config, result.metrics);

          // Also run detailed analysis
          console.log("\nDetailed latency distribution:");
          const analysis = await analyzeLatencyDistribution(config, {
            operations: Math.min(options.operations, 5000),
            concurrency: options.concurrency,
          });
          console.log(`  Scheduling p50: ${analysis.scheduling.percentiles.p50.toFixed(3)}ms`);
          console.log(`  Scheduling p99: ${analysis.scheduling.percentiles.p99.toFixed(3)}ms`);
          console.log(`  Queue wait p50: ${analysis.queueWait.percentiles.p50.toFixed(3)}ms`);
          console.log(`  Queue wait p99: ${analysis.queueWait.percentiles.p99.toFixed(3)}ms`);
        }

        if (jsonReporter) {
          jsonReporter.addResult(result.name, result.config, result.metrics);
        }
        break;
      }

      case "burst": {
        const analysis = await analyzeBurstBehavior(config, {
          burstSize: Math.min(options.operations / 10, 100),
          burstCount: 10,
          burstIntervalMs: 500,
          concurrency: options.concurrency,
        });

        if (!options.quiet) {
          console.log(`\n═══ Burst Analysis: ${config.name} ═══`);
          console.log(`  Total tasks: ${analysis.overall.totalTasks}`);
          console.log(`  Throughput: ${Math.round(analysis.overall.avgThroughput)} ops/sec`);
          console.log(`  Peak queue: ${analysis.overall.peakQueueSize}`);
          console.log(`  Latency p50: ${analysis.overall.latencyP50.toFixed(2)}ms`);
          console.log(`  Latency p99: ${analysis.overall.latencyP99.toFixed(2)}ms`);
        }
        break;
      }

      case "sustained": {
        const report = await runSustainedLoadTest(
          config,
          {
            durationMs: options.duration,
            targetOpsPerSecond: Math.min(options.operations / 10, 1000),
            concurrency: options.concurrency,
            reportIntervalMs: Math.max(1000, options.duration / 10),
          },
          options.quiet
            ? undefined
            : (interval) => {
                console.log(
                  `  [${(interval.timestamp / 1000).toFixed(0)}s] ${Math.round(interval.opsPerSecond)} ops/s, p99: ${interval.latencyP99.toFixed(2)}ms`
                );
              }
        );

        if (!options.quiet) {
          reportSustainedLoadResults(config.name, report);
        }
        break;
      }

      case "memory": {
        const report = await runMemoryStressTest(config, {
          iterations: Math.min(options.operations / 100, 100),
          tasksPerIteration: 100,
          concurrency: options.concurrency,
          allocationSizePerTask: 1024,
        });

        if (!options.quiet) {
          reportMemoryStressResults(config.name, report);
        }

        if (options.detectLeaks) {
          const leakCheck = await quickLeakCheck(config, {
            operations: options.operations,
            concurrency: options.concurrency,
          });

          if (!options.quiet) {
            reportMemoryLeakAnalysis(leakCheck);
          }
        }
        break;
      }

      case "max-throughput": {
        if (!options.quiet) {
          console.log(`\nFinding max throughput for: ${config.name}`);
        }

        const result = await findMaxThroughput(config, {
          testDurationMs: 5000,
        });

        if (!options.quiet) {
          console.log(`\n═══ Max Throughput: ${config.name} ═══`);
          console.log(`  Max ops/sec: ${result.maxOpsPerSecond.toLocaleString()}`);
          console.log(`  Optimal concurrency: ${result.sustainableConcurrency}`);
          console.log(`  Bottleneck: ${result.bottleneck}`);
        }
        break;
      }

      default:
        console.error(`Unknown scenario: ${scenario}`);
        process.exit(1);
    }

    // GC between configs
    forceGC();
  }

  // Write JSON output if requested
  if (jsonReporter && options.output) {
    await jsonReporter.writeToFile(options.output);
    console.log(`\nResults written to: ${options.output}`);
  }
}

async function main(): Promise<void> {
  const options = parseCliArgs();

  if (options.help) {
    console.log(HELP);
    process.exit(0);
  }

  // Print header
  const runtime = getRuntime();
  if (!options.quiet) {
    console.log("═".repeat(60));
    console.log(" bun-rate-limiter Benchmark Suite");
    console.log("═".repeat(60));
    console.log(` Runtime: ${runtime.name} ${runtime.version}`);
    console.log(` ${getGCStatus()}`);
    console.log("═".repeat(60));
  }

  // Handle compare mode
  if (options.compare || options.scenario === "compare") {
    if (!options.quiet) {
      console.log("\nRunning comparison benchmark...");
    }

    const available = await isPQueueAvailable();
    if (!available && !options.quiet) {
      console.log("Note: p-queue not installed, will only benchmark bun-rate-limiter");
    }

    const results = await runComparisonBenchmark({
      operations: options.operations,
      concurrency: options.concurrency,
    });

    if (!options.quiet) {
      printComparisonResults(results);
    }

    return;
  }

  // Get configurations to run
  let configs: RateLimiterConfig[];

  if (options.allConfigs) {
    configs = allLocalConfigs;
  } else {
    const config = getConfigByName(options.config);
    if (!config) {
      console.error(`Unknown config: ${options.config}`);
      console.log("\nAvailable configs:");
      for (const c of allLocalConfigs) {
        console.log(`  ${c.name}: ${c.description}`);
      }
      process.exit(1);
    }
    configs = [config];
  }

  await runScenario(options.scenario, configs, options);

  if (!options.quiet) {
    console.log("\nBenchmark complete!");
  }
}

main().catch((error) => {
  console.error("Benchmark failed:", error);
  process.exit(1);
});
