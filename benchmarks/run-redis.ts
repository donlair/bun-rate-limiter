#!/usr/bin/env bun
/**
 * Redis benchmark runner
 *
 * Runs benchmarks against Redis-backed rate limiters.
 * By default uses a mock Redis client. Use --real to connect to actual Redis.
 *
 * Usage:
 *   bun run benchmarks/run-redis.ts              # Mock Redis (no server needed)
 *   bun run benchmarks/run-redis.ts --real       # Real Redis (requires server)
 *   bun run benchmarks/run-redis.ts --real --url redis://host:6379
 *
 * Options:
 *   --real              Use real Redis instead of mock
 *   --url <url>         Redis connection URL (default: redis://localhost:6379)
 *   --operations, -n    Number of operations per benchmark (default: 1000)
 *   --concurrency       Concurrency level (default: 10)
 *   --config <name>     Run specific config only (e.g., redis-token-bucket)
 */

import { parseArgs } from "util";
import type { IRedisClient } from "../src/strategies/throttle/redis/IRedisClient.js";
import {
  getAllRedisConfigs,
  createMockRedisClient,
  redisTokenBucket,
  redisSpacing,
  redisFullComposition,
  redisWithLatency5ms,
  redisWithLatency20ms,
  redisWithLatency50ms,
} from "./configs/redis.js";
import { runBenchmark } from "./lib/runner.js";
import { createSharedLimiterThroughputBenchmark } from "./scenarios/throughput.js";
import { reportComparisonTable } from "./lib/reporters/console.js";
import { getRuntime, forceGC, delay } from "./lib/utils.js";
import type { BenchmarkMetrics } from "./lib/metrics.js";

interface CliOptions {
  real: boolean;
  url: string;
  operations: number;
  concurrency: number;
  config: string | null;
}

const HELP = `
Redis Benchmark Runner

Usage:
  bun run benchmarks/run-redis.ts [options]

Options:
  --real              Use real Redis instead of mock
  --url <url>         Redis connection URL (default: redis://localhost:6379)
  --operations, -n    Number of operations per benchmark (default: 1000)
  --concurrency       Concurrency level (default: 10)
  --config <name>     Run specific config only
  --help, -h          Show this help

Examples:
  # Run with mock Redis (no server needed)
  bun run benchmarks/run-redis.ts

  # Run with real Redis on localhost
  bun run benchmarks/run-redis.ts --real

  # Run with remote Redis
  bun run benchmarks/run-redis.ts --real --url redis://192.168.1.100:6379

  # Run specific config with more operations
  bun run benchmarks/run-redis.ts --config redis-token-bucket -n 5000
`;

function parseCliArgs(): CliOptions {
  try {
    const { values } = parseArgs({
      options: {
        real: { type: "boolean", default: false },
        url: { type: "string", default: "redis://localhost:6379" },
        operations: { type: "string", short: "n", default: "1000" },
        concurrency: { type: "string", default: "10" },
        config: { type: "string" },
        help: { type: "boolean", short: "h", default: false },
      },
    });

    if (values.help) {
      console.log(HELP);
      process.exit(0);
    }

    return {
      real: values.real as boolean,
      url: values.url as string,
      operations: parseInt(values.operations as string, 10),
      concurrency: parseInt(values.concurrency as string, 10),
      config: (values.config as string) || null,
    };
  } catch (error) {
    console.error("Error parsing arguments:", error);
    console.log(HELP);
    process.exit(1);
  }
}

async function createRealRedisClient(url: string): Promise<{
  client: IRedisClient;
  disconnect: () => Promise<void>;
}> {
  try {
    const { createClient } = await import("redis");
    const redis = createClient({ url });

    await redis.connect();

    const client: IRedisClient = {
      send: (cmd: string, args: readonly (string | number)[]) =>
        redis.sendCommand([cmd, ...args.map(String)]),
    };

    return {
      client,
      disconnect: async () => {
        await redis.quit();
      },
    };
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("Cannot find package")
    ) {
      console.error("\nError: 'redis' package not installed.");
      console.error("Install it with: bun add redis\n");
      process.exit(1);
    }
    throw error;
  }
}

function getConfigByName(
  name: string,
  redis: IRedisClient
): ReturnType<typeof redisTokenBucket> | null {
  const configMap: Record<string, () => ReturnType<typeof redisTokenBucket>> = {
    "redis-token-bucket": () => redisTokenBucket(redis),
    "redis-spacing": () => redisSpacing(redis),
    "redis-full": () => redisFullComposition(redis),
    "redis-latency-5ms": () => redisWithLatency5ms(redis),
    "redis-latency-20ms": () => redisWithLatency20ms(redis),
    "redis-latency-50ms": () => redisWithLatency50ms(redis),
  };

  const factory = configMap[name];
  return factory ? factory() : null;
}

async function main(): Promise<void> {
  const options = parseCliArgs();
  const runtime = getRuntime();

  // Setup Redis client
  let redisClient: IRedisClient;
  let disconnect: (() => Promise<void>) | null = null;

  if (options.real) {
    console.log(`\nConnecting to Redis at ${options.url}...`);
    try {
      const connection = await createRealRedisClient(options.url);
      redisClient = connection.client;
      disconnect = connection.disconnect;
      console.log("Connected!\n");
    } catch (error) {
      console.error(
        "\nFailed to connect to Redis:",
        error instanceof Error ? error.message : error
      );
      console.error("\nMake sure Redis is running. You can start it with:");
      console.error("  docker run -p 6379:6379 redis:alpine\n");
      process.exit(1);
    }
  } else {
    console.log("\nUsing mock Redis client (use --real for actual Redis)\n");
    redisClient = createMockRedisClient();
  }

  // Print header
  console.log("+" + "-".repeat(68) + "+");
  console.log("|" + " Redis Benchmark Suite".padEnd(68) + "|");
  console.log("+" + "-".repeat(68) + "+");
  console.log("|" + ` Runtime: ${runtime.name} ${runtime.version}`.padEnd(68) + "|");
  console.log(
    "|" + ` Redis: ${options.real ? options.url : "mock (in-memory)"}`.padEnd(68) + "|"
  );
  console.log(
    "|" + ` Operations: ${options.operations}, Concurrency: ${options.concurrency}`.padEnd(68) + "|"
  );
  console.log("+" + "-".repeat(68) + "+");

  // Get configs to run
  let configs = options.config
    ? [getConfigByName(options.config, redisClient)].filter(Boolean)
    : getAllRedisConfigs(redisClient);

  if (configs.length === 0) {
    console.error(`\nUnknown config: ${options.config}`);
    console.error("Available configs:");
    getAllRedisConfigs(redisClient).forEach((c) => console.error(`  - ${c.name}`));
    process.exit(1);
  }

  const results: Array<{ name: string; metrics: BenchmarkMetrics }> = [];

  // Run benchmarks
  console.log("\n");
  for (const config of configs) {
    if (!config) continue;

    console.log(`  Testing: ${config.name}...`);

    try {
      const benchmark = createSharedLimiterThroughputBenchmark(config, {
        operations: options.operations,
        concurrency: options.concurrency,
      });

      const result = await runBenchmark(benchmark);
      results.push({ name: config.name, metrics: result.metrics });

      console.log(
        `    -> ${Math.round(result.metrics.throughput.opsPerSecond).toLocaleString()} ops/sec`
      );
    } catch (error) {
      console.error(
        `    -> ERROR: ${error instanceof Error ? error.message : error}`
      );
    }

    forceGC();
    await delay(300);
  }

  // Print comparison table if multiple configs
  if (results.length > 1) {
    reportComparisonTable(results);
  }

  // Summary
  console.log("\n+" + "-".repeat(68) + "+");
  console.log("|" + " Benchmark Complete".padEnd(68) + "|");
  console.log("+" + "-".repeat(68) + "+");

  if (results.length > 0) {
    const fastest = results.reduce((a, b) =>
      a.metrics.throughput.opsPerSecond > b.metrics.throughput.opsPerSecond ? a : b
    );
    console.log(
      "|" +
        ` Fastest: ${fastest.name} (${Math.round(fastest.metrics.throughput.opsPerSecond).toLocaleString()} ops/sec)`.padEnd(68) +
        "|"
    );
  }

  if (!options.real) {
    console.log("|" + "".padEnd(68) + "|");
    console.log("|" + " Note: Using mock Redis. Run with --real for actual Redis.".padEnd(68) + "|");
  }

  console.log("+" + "-".repeat(68) + "+\n");

  // Cleanup
  if (disconnect) {
    await disconnect();
  }
}

main().catch((error) => {
  console.error("Benchmark failed:", error);
  process.exit(1);
});
