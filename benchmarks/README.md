# bun-rate-limiter Benchmarks

Comprehensive performance and load testing harness for bun-rate-limiter.

## Quick Start

```bash
# Run basic throughput benchmark
bun run benchmarks/run.ts

# Run full benchmark suite
bun run benchmarks/run-all.ts

# Quick benchmarks (fewer operations)
bun run benchmarks/run-all.ts --quick

# Full benchmarks (more thorough)
bun run benchmarks/run-all.ts --full
```

## Scenarios

### Throughput (`--scenario throughput`)
Measures maximum operations per second under various configurations.

```bash
bun run benchmarks/run.ts --scenario throughput --config token-bucket
bun run benchmarks/run.ts --scenario throughput --all-configs
```

### Latency (`--scenario latency`)
Measures scheduling and execution latency with detailed percentile breakdown.

```bash
bun run benchmarks/run.ts --scenario latency --operations 5000
```

### Burst (`--scenario burst`)
Tests how well the limiter handles sudden spikes in load.

```bash
bun run benchmarks/run.ts --scenario burst --config api-rate-limit
```

### Sustained Load (`--scenario sustained`)
Tests performance stability under prolonged load.

```bash
bun run benchmarks/run.ts --scenario sustained --duration 60000
```

### Memory (`--scenario memory`)
Tests memory behavior and detects potential leaks.

```bash
bun run benchmarks/run.ts --scenario memory --detect-leaks
```

### Max Throughput (`--scenario max-throughput`)
Finds maximum sustainable throughput for a configuration.

```bash
bun run benchmarks/run.ts --scenario max-throughput --config baseline
```

### Comparison (`--compare`)
Compares performance with p-queue library.

```bash
# Install p-queue first
npm install p-queue

# Run comparison
bun run benchmarks/run.ts --compare --operations 50000
```

## Configurations

| Config | Description |
|--------|-------------|
| `baseline` | Pure concurrency control (no throttling) |
| `token-bucket` | Token bucket with 1000 tokens, 100/100ms refill |
| `token-bucket-high` | High-capacity token bucket (10000 tokens) |
| `spacing` | 10ms minimum delay between tasks |
| `spacing-tight` | 1ms minimum delay |
| `interval` | Max 100 operations per second |
| `interval-high` | Max 10000 operations per second |
| `bucket+spacing` | Token bucket + spacing composition |
| `bucket+interval` | Token bucket + interval composition |
| `spacing+interval` | Spacing + interval composition |
| `full-composition` | All throttlers combined |
| `api-rate-limit` | Realistic API rate limiting (60 req/min) |
| `high-throughput-api` | High-throughput API (2000 req/min) |

## CLI Options

```
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
--help, -h              Show help
```

## Running with Node.js

The benchmarks also work with Node.js (requires Node 22+ for TypeScript support):

```bash
# Node.js with experimental TypeScript
node --experimental-strip-types benchmarks/run.ts --scenario throughput

# For accurate memory measurements, expose GC
node --experimental-strip-types --expose-gc benchmarks/run.ts --scenario memory
```

## Redis Benchmarks

To test Redis-backed configurations:

1. Start a local Redis server:
   ```bash
   docker run -p 6379:6379 redis:alpine
   ```

2. Create a custom benchmark script (e.g., `benchmarks/redis-bench.ts`):
   ```typescript
   // Run from project root: bun run benchmarks/redis-bench.ts
   import { createClient } from "redis";
   import { getAllRedisConfigs } from "./configs/redis.js";
   import { runBenchmark } from "./lib/runner.js";
   import { createSharedLimiterThroughputBenchmark } from "./scenarios/throughput.js";

   const redis = createClient();
   await redis.connect();

   // Adapt redis client to IRedisClient interface
   const redisClient = {
     send: (cmd: string, args: readonly (string | number)[]) =>
       redis.sendCommand([cmd, ...args.map(String)]),
   };

   const configs = getAllRedisConfigs(redisClient);

   for (const config of configs) {
     const benchmark = createSharedLimiterThroughputBenchmark(config);
     const result = await runBenchmark(benchmark);
     console.log(`${config.name}: ${result.metrics.throughput.opsPerSecond} ops/sec`);
   }

   await redis.quit();
   ```

## Output Formats

### Console Output

The default console reporter shows:
- Throughput (ops/sec)
- Latency percentiles (p50, p75, p90, p95, p99)
- Memory usage (start, end, peak, delta)
- Errors and timeouts

### JSON Output

Use `--output results.json` to generate machine-readable results:

```json
{
  "metadata": {
    "timestamp": "2024-01-15T10:30:00.000Z",
    "runtime": { "name": "bun", "version": "1.0.0" },
    "platform": "darwin 23.0.0 (arm64)",
    "cpus": 10,
    "totalMemory": 17179869184
  },
  "results": [
    {
      "name": "Throughput: baseline",
      "config": "concurrency=10, ops=10000",
      "metrics": {
        "throughput": { "opsPerSecond": 150000, ... },
        "latency": { "p50": 0.05, "p99": 0.15, ... },
        "memory": { ... }
      }
    }
  ],
  "summary": {
    "fastest": "baseline",
    "slowest": "full-composition",
    "mostMemoryEfficient": "baseline"
  }
}
```

## Architecture

```
benchmarks/
├── lib/                    # Core utilities
│   ├── runner.ts           # Benchmark execution engine
│   ├── metrics.ts          # Throughput/latency collection
│   ├── memory-tracker.ts   # Memory & leak detection
│   ├── utils.ts            # Helpers (delay, GC, formatting)
│   └── reporters/          # Output formatters
│       ├── console.ts      # Terminal output
│       └── json.ts         # JSON export
├── scenarios/              # Test scenarios
│   ├── throughput.ts       # Max ops/sec testing
│   ├── latency.ts          # Scheduling latency
│   ├── burst.ts            # Spike handling
│   ├── sustained.ts        # Long-running stability
│   └── memory-stress.ts    # Memory pressure & leaks
├── configs/                # Rate limiter configurations
│   ├── memory-only.ts      # In-memory throttlers
│   ├── compositions.ts     # Multi-throttler setups
│   └── redis.ts            # Redis-backed configs
├── competitors/            # Comparison adapters
│   └── p-queue-adapter.ts  # p-queue wrapper
├── run.ts                  # Single benchmark CLI
└── run-all.ts              # Full suite CLI
```

## Extending

### Adding a New Scenario

```typescript
// scenarios/my-scenario.ts
import { RateLimiter } from "../../src/index.js";
import type { BenchmarkDefinition } from "../lib/runner.js";
import type { RateLimiterConfig } from "../configs/types.js";

export function createMyBenchmark(
  config: RateLimiterConfig,
  options: { operations?: number } = {}
): BenchmarkDefinition {
  const { operations = 10000 } = options;

  return {
    name: `My Benchmark: ${config.name}`,
    config: `ops=${operations}`,
    setup: async () => {
      const limiter = new RateLimiter(config.options);
      return { cleanup: async () => limiter.clear() };
    },
    fn: async () => {
      // Your benchmark logic
    },
    options: { operations },
  };
}
```

### Adding a New Configuration

```typescript
// configs/my-config.ts
import type { RateLimiterConfig } from "./types.js";

export const myConfig: RateLimiterConfig = {
  name: "my-config",
  description: "My custom configuration",
  options: {
    concurrency: 20,
    limits: {
      tokenBucket: {
        capacity: 500,
        refillAmount: 50,
        refillInterval: 100,
      },
    },
  },
  category: "composition",
};
```

## Tips

1. **Accurate memory measurements**: Run with `--expose-gc` (Node) or use Bun (has built-in GC control)

2. **Reduce noise**: Close other applications, disable background processes

3. **Multiple runs**: Run benchmarks multiple times for reliable results

4. **Compare runtimes**: Run the same benchmark with both Bun and Node to compare

5. **Profile bottlenecks**: Use `--scenario max-throughput` to find optimal concurrency
