/**
 * In-memory only configurations (no Redis)
 */

import type { RateLimiterConfig } from "./types.js";

/** Baseline - no throttling, just concurrency control */
export const baseline: RateLimiterConfig = {
  name: "baseline",
  description: "Pure concurrency control, no rate limiting",
  options: {},
  category: "baseline",
};

/** Token bucket throttler only */
export const tokenBucket: RateLimiterConfig = {
  name: "token-bucket",
  description: "Token bucket with 1000 tokens, refills 100/100ms",
  options: {
    limits: {
      tokenBucket: {
        capacity: 1000,
        refillAmount: 100,
        refillInterval: 100,
      },
    },
  },
  category: "throttler",
};

/** High-capacity token bucket */
export const tokenBucketHighCapacity: RateLimiterConfig = {
  name: "token-bucket-high",
  description: "Token bucket with 10000 tokens, refills 1000/100ms",
  options: {
    limits: {
      tokenBucket: {
        capacity: 10000,
        refillAmount: 1000,
        refillInterval: 100,
      },
    },
  },
  category: "throttler",
};

/** Spacing throttler only */
export const spacing: RateLimiterConfig = {
  name: "spacing",
  description: "Minimum 10ms between task starts",
  options: {
    limits: {
      minDelayMs: 10,
    },
  },
  category: "throttler",
};

/** Tight spacing */
export const spacingTight: RateLimiterConfig = {
  name: "spacing-tight",
  description: "Minimum 1ms between task starts",
  options: {
    limits: {
      minDelayMs: 1,
    },
  },
  category: "throttler",
};

/** Interval throttler only */
export const interval: RateLimiterConfig = {
  name: "interval",
  description: "Max 100 operations per second (sliding window)",
  options: {
    limits: {
      interval: {
        limit: 100,
        interval: 1000,
      },
    },
  },
  category: "throttler",
};

/** High-throughput interval */
export const intervalHighThroughput: RateLimiterConfig = {
  name: "interval-high",
  description: "Max 10000 operations per second (sliding window)",
  options: {
    limits: {
      interval: {
        limit: 10000,
        interval: 1000,
      },
    },
  },
  category: "throttler",
};

/** All memory configs */
export const memoryConfigs: RateLimiterConfig[] = [
  baseline,
  tokenBucket,
  tokenBucketHighCapacity,
  spacing,
  spacingTight,
  interval,
  intervalHighThroughput,
];
