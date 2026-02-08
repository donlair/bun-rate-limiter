/**
 * Redis-backed configurations
 */

import type { RateLimiterConfig, RedisConfig } from "./types.js";
import type { IRedisClient } from "../../src/strategies/throttle/redis/IRedisClient.js";
import { delay } from "../lib/utils.js";

/**
 * Create a delayed Redis client wrapper for network latency simulation
 */
export function createDelayedRedisClient(
  client: IRedisClient,
  delayMs: number
): IRedisClient {
  return {
    async send(
      command: string,
      args: readonly (string | number)[]
    ): Promise<unknown> {
      // Simulate network latency in both directions
      await delay(delayMs / 2);
      const result = await client.send(command, args);
      await delay(delayMs / 2);
      return result;
    },
  };
}

/**
 * Create Redis backend configuration
 */
export function createRedisBackend(
  redis: IRedisClient,
  keyPrefix = "benchmark:"
): { type: "redis"; redis: IRedisClient; keyPrefix: string } {
  return {
    type: "redis",
    redis,
    keyPrefix,
  };
}

/**
 * Redis token bucket configuration
 */
export function redisTokenBucket(redis: IRedisClient): RateLimiterConfig {
  return {
    name: "redis-token-bucket",
    description: "Redis-backed token bucket (1000 tokens, 100/100ms refill)",
    options: {
      backend: createRedisBackend(redis),
      limits: {
        tokenBucket: {
          capacity: 1000,
          refillAmount: 100,
          refillInterval: 100,
        },
      },
    },
    category: "redis",
    requiresRedis: true,
  };
}

/**
 * Redis spacing configuration
 */
export function redisSpacing(redis: IRedisClient): RateLimiterConfig {
  return {
    name: "redis-spacing",
    description: "Redis-backed spacing (10ms minimum)",
    options: {
      backend: createRedisBackend(redis),
      limits: {
        minDelayMs: 10,
      },
    },
    category: "redis",
    requiresRedis: true,
  };
}

/**
 * Redis full composition
 */
export function redisFullComposition(redis: IRedisClient): RateLimiterConfig {
  return {
    name: "redis-full",
    description: "Redis-backed token bucket + spacing",
    options: {
      backend: createRedisBackend(redis),
      limits: {
        tokenBucket: {
          capacity: 500,
          refillAmount: 50,
          refillInterval: 100,
        },
        minDelayMs: 5,
      },
    },
    category: "redis",
    requiresRedis: true,
  };
}

/**
 * Redis with simulated 5ms network latency
 */
export function redisWithLatency5ms(redis: IRedisClient): RateLimiterConfig {
  const delayedRedis = createDelayedRedisClient(redis, 5);
  return {
    name: "redis-latency-5ms",
    description: "Redis with 5ms simulated network latency",
    options: {
      backend: createRedisBackend(delayedRedis),
      limits: {
        tokenBucket: {
          capacity: 1000,
          refillAmount: 100,
          refillInterval: 100,
        },
      },
    },
    category: "redis",
    requiresRedis: true,
  };
}

/**
 * Redis with simulated 20ms network latency
 */
export function redisWithLatency20ms(redis: IRedisClient): RateLimiterConfig {
  const delayedRedis = createDelayedRedisClient(redis, 20);
  return {
    name: "redis-latency-20ms",
    description: "Redis with 20ms simulated network latency",
    options: {
      backend: createRedisBackend(delayedRedis),
      limits: {
        tokenBucket: {
          capacity: 1000,
          refillAmount: 100,
          refillInterval: 100,
        },
      },
    },
    category: "redis",
    requiresRedis: true,
  };
}

/**
 * Redis with simulated 50ms network latency (high latency scenario)
 */
export function redisWithLatency50ms(redis: IRedisClient): RateLimiterConfig {
  const delayedRedis = createDelayedRedisClient(redis, 50);
  return {
    name: "redis-latency-50ms",
    description: "Redis with 50ms simulated network latency",
    options: {
      backend: createRedisBackend(delayedRedis),
      limits: {
        tokenBucket: {
          capacity: 1000,
          refillAmount: 100,
          refillInterval: 100,
        },
      },
    },
    category: "redis",
    requiresRedis: true,
  };
}

/**
 * Get all Redis configurations for a given client
 */
export function getAllRedisConfigs(redis: IRedisClient): RateLimiterConfig[] {
  return [
    redisTokenBucket(redis),
    redisSpacing(redis),
    redisFullComposition(redis),
    redisWithLatency5ms(redis),
    redisWithLatency20ms(redis),
    redisWithLatency50ms(redis),
  ];
}

/**
 * Mock Redis client for testing without Redis
 * Simulates Redis behavior in-memory
 */
export function createMockRedisClient(): IRedisClient {
  const store = new Map<string, string>();

  return {
    async send(
      command: string,
      args: readonly (string | number)[]
    ): Promise<unknown> {
      const cmd = command.toUpperCase();

      switch (cmd) {
        case "SET": {
          const [key, value] = args;
          store.set(String(key), String(value));
          return "OK";
        }
        case "GET": {
          const [key] = args;
          return store.get(String(key)) ?? null;
        }
        case "DEL": {
          let deleted = 0;
          for (const key of args) {
            if (store.delete(String(key))) deleted++;
          }
          return deleted;
        }
        case "EVAL":
        case "EVALSHA": {
          // For benchmarking, we'll simulate a successful acquire
          // In real usage, the Lua scripts would handle this
          return [1, 0]; // [granted, delay]
        }
        case "SCRIPT": {
          // Return a fake SHA
          return "abc123";
        }
        default:
          console.warn(`[mock-redis] Unhandled command: ${cmd}`);
          return null;
      }
    },
  };
}
