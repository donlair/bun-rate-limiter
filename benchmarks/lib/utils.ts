/**
 * Utility functions for benchmarks
 */

/** Delay for a specified number of milliseconds */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Detect runtime environment */
export function getRuntime(): { name: "bun" | "node"; version: string } {
  if (typeof Bun !== "undefined") {
    return { name: "bun", version: Bun.version };
  }
  return { name: "node", version: process.version };
}

/** Force garbage collection if available */
export function forceGC(): void {
  const runtime = getRuntime();
  if (runtime.name === "bun") {
    Bun.gc(true);
  } else if (typeof global.gc === "function") {
    global.gc();
  }
}

/** Check if GC is available */
export function isGCAvailable(): boolean {
  const runtime = getRuntime();
  if (runtime.name === "bun") return true;
  return typeof global.gc === "function";
}

/** Simulated CPU work - computes hash iterations */
export function simulateCpuWork(iterations: number): number {
  let hash = 0;
  for (let i = 0; i < iterations; i++) {
    hash = ((hash << 5) - hash + i) | 0;
  }
  return hash;
}

/** Simulated async work with optional CPU component */
export async function simulateWork(options: {
  asyncDelayMs?: number;
  cpuIterations?: number;
}): Promise<void> {
  const { asyncDelayMs = 0, cpuIterations = 0 } = options;

  if (cpuIterations > 0) {
    simulateCpuWork(cpuIterations);
  }

  if (asyncDelayMs > 0) {
    await delay(asyncDelayMs);
  }
}

/** Format bytes to human readable string */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** Format number with thousands separators */
export function formatNumber(num: number): string {
  return num.toLocaleString("en-US");
}

/** Format duration in milliseconds to human readable */
export function formatDuration(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(2)}μs`;
  if (ms < 1000) return `${ms.toFixed(2)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
  return `${(ms / 60000).toFixed(2)}m`;
}

/** High-resolution timer */
export function now(): number {
  return performance.now();
}

/** Generate a unique ID */
export function generateId(): string {
  return Math.random().toString(36).substring(2, 10);
}

/** Async iterator to array */
export async function collectAsync<T>(
  iterable: AsyncIterable<T>
): Promise<T[]> {
  const results: T[] = [];
  for await (const item of iterable) {
    results.push(item);
  }
  return results;
}

/** Create a deferred promise */
export function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
