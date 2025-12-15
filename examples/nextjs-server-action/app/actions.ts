'use server';

import { withRateLimit } from './rate-limiter';

/**
 * Example: Rate-limited API call server action
 *
 * This server action wraps an external API call with rate limiting.
 * The rate limit is enforced globally via Redis, so it works across:
 * - Multiple Vercel serverless instances
 * - Edge functions
 * - Multiple regions
 */
export async function fetchExternalData(query: string): Promise<{
  data: string;
  timestamp: number;
  rateLimited: boolean;
}> {
  const startTime = Date.now();

  try {
    // Wrap the API call with rate limiting
    const data = await withRateLimit(async () => {
      // Simulate external API call
      // In production, this would be:
      // const response = await fetch('https://api.example.com/data?q=' + query);
      // return response.json();

      await new Promise((resolve) => setTimeout(resolve, 50)); // Simulate latency
      return `Result for "${query}" at ${new Date().toISOString()}`;
    });

    return {
      data,
      timestamp: Date.now() - startTime,
      rateLimited: false,
    };
  } catch (error) {
    // If rate limiter is overwhelmed, tasks will queue up
    // This shouldn't normally throw unless the queue is paused or cleared
    console.error('Rate limiter error:', error);
    throw error;
  }
}

/**
 * Example: Get current rate limiter status
 */
export async function getRateLimiterStatus(): Promise<{
  pending: number;
  running: number;
  isRateLimited: boolean;
  isSaturated: boolean;
}> {
  const { getRateLimiter } = await import('./rate-limiter');
  const limiter = await getRateLimiter();

  return {
    pending: limiter.size,
    running: limiter.pending,
    isRateLimited: limiter.isRateLimited,
    isSaturated: limiter.isSaturated,
  };
}
