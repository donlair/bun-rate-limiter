/**
 * Export all benchmark configurations
 */

export * from "./types.js";
export * from "./memory-only.js";
export * from "./compositions.js";
export * from "./redis.js";

import { memoryConfigs } from "./memory-only.js";
import { compositionConfigs } from "./compositions.js";
import type { RateLimiterConfig } from "./types.js";

/** All non-Redis configurations */
export const allLocalConfigs: RateLimiterConfig[] = [
  ...memoryConfigs,
  ...compositionConfigs,
];

/** Get configs by category */
export function getConfigsByCategory(
  category: RateLimiterConfig["category"]
): RateLimiterConfig[] {
  return allLocalConfigs.filter((c) => c.category === category);
}

/** Get a config by name */
export function getConfigByName(name: string): RateLimiterConfig | undefined {
  return allLocalConfigs.find((c) => c.name === name);
}
