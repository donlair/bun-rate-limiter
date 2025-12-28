/**
 * Throttler composition configurations
 */

import type { RateLimiterConfig } from "./types.js";

/** Token bucket + spacing */
export const tokenBucketWithSpacing: RateLimiterConfig = {
  name: "bucket+spacing",
  description: "Token bucket (1000 tokens) + 5ms spacing",
  options: {
    limits: {
      tokenBucket: {
        capacity: 1000,
        refillAmount: 100,
        refillInterval: 100,
      },
      minDelayMs: 5,
    },
  },
  category: "composition",
};

/** Token bucket + interval */
export const tokenBucketWithInterval: RateLimiterConfig = {
  name: "bucket+interval",
  description: "Token bucket (1000 tokens) + interval (500/sec)",
  options: {
    limits: {
      tokenBucket: {
        capacity: 1000,
        refillAmount: 100,
        refillInterval: 100,
      },
      interval: {
        limit: 500,
        interval: 1000,
      },
    },
  },
  category: "composition",
};

/** Spacing + interval */
export const spacingWithInterval: RateLimiterConfig = {
  name: "spacing+interval",
  description: "5ms spacing + interval (200/sec)",
  options: {
    limits: {
      minDelayMs: 5,
      interval: {
        limit: 200,
        interval: 1000,
      },
    },
  },
  category: "composition",
};

/** All three throttlers */
export const fullComposition: RateLimiterConfig = {
  name: "full-composition",
  description: "Token bucket + spacing + interval",
  options: {
    limits: {
      tokenBucket: {
        capacity: 500,
        refillAmount: 50,
        refillInterval: 100,
      },
      minDelayMs: 2,
      interval: {
        limit: 300,
        interval: 1000,
      },
    },
  },
  category: "composition",
};

/** API-like rate limiting (realistic scenario) */
export const apiRateLimiting: RateLimiterConfig = {
  name: "api-rate-limit",
  description: "Realistic API rate limiting: 60 req/min burst, 30ms spacing",
  options: {
    limits: {
      tokenBucket: {
        capacity: 60,
        refillAmount: 60,
        refillInterval: 60000, // 60 per minute
      },
      minDelayMs: 30, // ~33 req/sec max
    },
  },
  category: "composition",
};

/** High-throughput API */
export const highThroughputApi: RateLimiterConfig = {
  name: "high-throughput-api",
  description: "High-throughput: 2000 req/min, 5ms spacing",
  options: {
    limits: {
      tokenBucket: {
        capacity: 2000,
        refillAmount: 2000,
        refillInterval: 60000,
      },
      minDelayMs: 5,
    },
  },
  category: "composition",
};

/** All composition configs */
export const compositionConfigs: RateLimiterConfig[] = [
  tokenBucketWithSpacing,
  tokenBucketWithInterval,
  spacingWithInterval,
  fullComposition,
  apiRateLimiting,
  highThroughputApi,
];
