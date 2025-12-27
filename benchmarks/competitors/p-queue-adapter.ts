/**
 * p-queue adapter for benchmark comparison
 *
 * This adapter wraps p-queue to provide the same interface
 * as our RateLimiter for fair comparison.
 */

import type { CompetitorAdapter, CompetitorConfig } from "../configs/types.js";

/**
 * Dynamic import of p-queue (must be installed separately)
 */
async function importPQueue(): Promise<typeof import("p-queue")> {
  try {
    return await import("p-queue");
  } catch {
    throw new Error(
      "p-queue is not installed. Run: npm install p-queue (or bun add p-queue)"
    );
  }
}

/**
 * p-queue adapter implementing CompetitorAdapter interface
 */
export class PQueueAdapter implements CompetitorAdapter {
  private queue: any; // p-queue instance
  private _pending = 0;

  constructor(queue: any) {
    this.queue = queue;
  }

  async add<T>(fn: () => Promise<T>): Promise<T> {
    this._pending++;
    try {
      return await this.queue.add(fn);
    } finally {
      this._pending--;
    }
  }

  clear(): void {
    this.queue.clear();
  }

  get size(): number {
    return this.queue.size;
  }

  get pending(): number {
    return this.queue.pending;
  }
}

/**
 * Create a p-queue adapter with specified concurrency
 */
export async function createPQueueAdapter(
  concurrency: number
): Promise<CompetitorAdapter> {
  const PQueue = await importPQueue();
  const queue = new PQueue.default({ concurrency });
  return new PQueueAdapter(queue);
}

/**
 * p-queue competitor configuration
 */
export const pQueueConfig: CompetitorConfig = {
  name: "p-queue",
  description: "Popular promise queue library (sindresorhus/p-queue)",
  factory: (concurrency: number) => {
    // We need to return synchronously, so we create a lazy adapter
    return new LazyPQueueAdapter(concurrency);
  },
};

/**
 * Lazy adapter that initializes p-queue on first use
 */
class LazyPQueueAdapter implements CompetitorAdapter {
  private adapter: CompetitorAdapter | null = null;
  private initPromise: Promise<CompetitorAdapter> | null = null;
  private concurrency: number;

  constructor(concurrency: number) {
    this.concurrency = concurrency;
  }

  private async ensureInitialized(): Promise<CompetitorAdapter> {
    if (this.adapter) return this.adapter;

    if (!this.initPromise) {
      this.initPromise = createPQueueAdapter(this.concurrency).then(
        (adapter) => {
          this.adapter = adapter;
          return adapter;
        }
      );
    }

    return this.initPromise;
  }

  async add<T>(fn: () => Promise<T>): Promise<T> {
    const adapter = await this.ensureInitialized();
    return adapter.add(fn);
  }

  clear(): void {
    if (this.adapter) {
      this.adapter.clear();
    }
  }

  get size(): number {
    return this.adapter?.size ?? 0;
  }

  get pending(): number {
    return this.adapter?.pending ?? 0;
  }
}

/**
 * Check if p-queue is available
 */
export async function isPQueueAvailable(): Promise<boolean> {
  try {
    await importPQueue();
    return true;
  } catch {
    return false;
  }
}

/**
 * Run comparison benchmark between bun-rate-limiter and p-queue
 */
export async function runComparisonBenchmark(options: {
  operations?: number;
  concurrency?: number;
  taskDelayMs?: number;
}): Promise<{
  bunRateLimiter: { opsPerSecond: number; totalTimeMs: number };
  pQueue: { opsPerSecond: number; totalTimeMs: number } | null;
  comparison: {
    winner: "bun-rate-limiter" | "p-queue" | "tie";
    differencePercent: number;
  } | null;
}> {
  const { operations = 10000, concurrency = 10, taskDelayMs = 0 } = options;

  // Import dynamically to avoid requiring the dependency
  const { RateLimiter } = await import("../../src/index.js");
  const { delay, now } = await import("../lib/utils.js");

  // Test bun-rate-limiter
  const limiter = new RateLimiter({ concurrency });
  const limiterStart = now();

  const limiterPromises: Promise<void>[] = [];
  for (let i = 0; i < operations; i++) {
    limiterPromises.push(
      limiter.add(async () => {
        if (taskDelayMs > 0) await delay(taskDelayMs);
      })
    );
  }
  await Promise.all(limiterPromises);
  limiter.clear();

  const limiterTime = now() - limiterStart;
  const limiterOps = (operations / limiterTime) * 1000;

  // Test p-queue if available
  let pQueueResult: { opsPerSecond: number; totalTimeMs: number } | null = null;
  let comparison: {
    winner: "bun-rate-limiter" | "p-queue" | "tie";
    differencePercent: number;
  } | null = null;

  if (await isPQueueAvailable()) {
    const pQueueAdapter = await createPQueueAdapter(concurrency);
    const pQueueStart = now();

    const pQueuePromises: Promise<void>[] = [];
    for (let i = 0; i < operations; i++) {
      pQueuePromises.push(
        pQueueAdapter.add(async () => {
          if (taskDelayMs > 0) await delay(taskDelayMs);
        })
      );
    }
    await Promise.all(pQueuePromises);
    pQueueAdapter.clear();

    const pQueueTime = now() - pQueueStart;
    const pQueueOps = (operations / pQueueTime) * 1000;

    pQueueResult = { opsPerSecond: pQueueOps, totalTimeMs: pQueueTime };

    // Calculate comparison
    const difference = limiterOps - pQueueOps;
    const differencePercent = (difference / pQueueOps) * 100;

    let winner: "bun-rate-limiter" | "p-queue" | "tie";
    if (Math.abs(differencePercent) < 5) {
      winner = "tie";
    } else if (differencePercent > 0) {
      winner = "bun-rate-limiter";
    } else {
      winner = "p-queue";
    }

    comparison = { winner, differencePercent };
  }

  return {
    bunRateLimiter: { opsPerSecond: limiterOps, totalTimeMs: limiterTime },
    pQueue: pQueueResult,
    comparison,
  };
}

/**
 * Print comparison results
 */
export function printComparisonResults(results: {
  bunRateLimiter: { opsPerSecond: number; totalTimeMs: number };
  pQueue: { opsPerSecond: number; totalTimeMs: number } | null;
  comparison: {
    winner: "bun-rate-limiter" | "p-queue" | "tie";
    differencePercent: number;
  } | null;
}): void {
  console.log();
  console.log("═".repeat(60));
  console.log(" Library Comparison: bun-rate-limiter vs p-queue");
  console.log("═".repeat(60));

  console.log();
  console.log(" bun-rate-limiter:");
  console.log(
    `   Throughput: ${Math.round(results.bunRateLimiter.opsPerSecond).toLocaleString()} ops/sec`
  );
  console.log(
    `   Total time: ${(results.bunRateLimiter.totalTimeMs / 1000).toFixed(2)}s`
  );

  if (results.pQueue) {
    console.log();
    console.log(" p-queue:");
    console.log(
      `   Throughput: ${Math.round(results.pQueue.opsPerSecond).toLocaleString()} ops/sec`
    );
    console.log(`   Total time: ${(results.pQueue.totalTimeMs / 1000).toFixed(2)}s`);

    if (results.comparison) {
      console.log();
      console.log(" Comparison:");

      const winnerText =
        results.comparison.winner === "tie"
          ? "TIE (within 5%)"
          : results.comparison.winner === "bun-rate-limiter"
            ? "bun-rate-limiter WINS"
            : "p-queue WINS";

      const color =
        results.comparison.winner === "bun-rate-limiter"
          ? "\x1b[32m"
          : results.comparison.winner === "p-queue"
            ? "\x1b[33m"
            : "\x1b[36m";

      console.log(`   ${color}${winnerText}\x1b[0m`);
      console.log(
        `   Difference: ${results.comparison.differencePercent > 0 ? "+" : ""}${results.comparison.differencePercent.toFixed(1)}%`
      );
    }
  } else {
    console.log();
    console.log(" p-queue: NOT INSTALLED");
    console.log("   Run 'npm install p-queue' to enable comparison");
  }

  console.log("═".repeat(60));
  console.log();
}
