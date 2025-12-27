/**
 * Configuration types for benchmarks
 */

import type { RateLimiterOptions } from "../../src/index.js";

export interface RateLimiterConfig {
  /** Name of the configuration */
  name: string;
  /** Description of what this configuration tests */
  description: string;
  /** RateLimiter options */
  options: Partial<RateLimiterOptions>;
  /** Category for grouping */
  category: "baseline" | "throttler" | "composition" | "redis" | "comparison";
  /** Whether this config requires Redis */
  requiresRedis?: boolean;
}

export interface RedisConfig {
  host: string;
  port: number;
  keyPrefix?: string;
}

export interface CompetitorConfig {
  name: string;
  description: string;
  factory: (concurrency: number) => CompetitorAdapter;
}

export interface CompetitorAdapter {
  add<T>(fn: () => Promise<T>): Promise<T>;
  clear(): void;
  readonly size: number;
  readonly pending: number;
}
