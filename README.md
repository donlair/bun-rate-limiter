# bun-rate-limiter

[![npm version](https://img.shields.io/npm/v/bun-rate-limiter.svg)](https://www.npmjs.com/package/bun-rate-limiter)
[![npm downloads](https://img.shields.io/npm/dm/bun-rate-limiter.svg)](https://www.npmjs.com/package/bun-rate-limiter)
[![GitHub](https://img.shields.io/github/stars/donlair/bun-rate-limiter?style=social)](https://github.com/donlair/bun-rate-limiter)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A lightweight, zero-runtime-dependency task scheduler and rate limiter. Built with Bun, runs anywhere—Node.js 18+, Vercel, AWS Lambda, and more.

**What makes this different?** Composable throttlers. Instead of a single rate limiting strategy, you combine multiple throttlers that work together (anti-burst spacing, token buckets, interval caps) and the scheduler enforces the most restrictive constraint. Need "2000 requests/minute with 10ms minimum between requests"? That's two throttlers composed together, and it works the same locally or distributed via Redis.

Use this if you need:
- **API rate limiting** with precise control (burst limits + smoothing)
- **Distributed rate limiting** via Redis that works across serverless instances
- **Composable strategies** that combine spacing, intervals, and token buckets
- **Similar API to p-queue** with more flexible throttling options

## Quick Decision

**Use this library if:**
- You need distributed rate limiting across serverless instances (Vercel, Lambda)
- You want composable strategies (burst limits + smoothing + per-key limits)
- You're okay with Redis as a dependency for distributed limiting

**Consider alternatives if:**
- You only need single-process rate limiting (simpler options exist)
- You can't tolerate any Redis downtime (no automatic fallback)
- You need sub-5ms latency (Redis adds network overhead)

## TL;DR: API Rate Limiting Recipe

Most users want this: **2000 requests/minute with anti-burst smoothing**. Copy-paste and adjust the numbers:

```typescript
import { RateLimiter } from 'bun-rate-limiter';

const limiter = new RateLimiter({
  concurrency: 50,
  limits: {
    minDelayMs: 30,  // Anti-burst: ~33 req/sec max burst rate
    tokenBucket: {
      capacity: 2000,       // Allow burst up to 2000
      refillAmount: 2000,   // Refill 2000 tokens
      refillInterval: 60_000, // Every 60 seconds
    },
  },
});

// All API calls go through the limiter
const data = await limiter.add(() => fetch('https://api.example.com/data'));
```

**Need distributed rate limiting?** Add Redis (works on Vercel, AWS Lambda, etc.):

```typescript
import { RateLimiter } from 'bun-rate-limiter';

// For Node.js, see "Using with Node.js" section for adapters
const limiter = new RateLimiter({
  concurrency: 50,
  backend: { type: 'redis', redis: redisClient, keyPrefix: 'myapp:rl' },
  limits: {
    minDelayMs: 30,
    tokenBucket: { capacity: 2000, refillAmount: 2000, refillInterval: 60_000 },
  },
  defaultRateLimitKey: 'api', // All requests share this limit
});
```

## Compatibility

**Runs on:** Node.js 18+, Bun, Deno (untested), Vercel, AWS Lambda, Cloudflare Workers
**Package managers:** npm, pnpm, yarn, bun

*Why "bun-rate-limiter"?* The project uses Bun's tooling for development (tests, builds), but publishes standard JavaScript that runs anywhere—like a TypeScript library.

## Installation

```bash
bun add bun-rate-limiter
```

```bash
pnpm add bun-rate-limiter
```

```bash
yarn add bun-rate-limiter
```

```bash
npm i bun-rate-limiter
```

## Quick Start

```typescript
import { RateLimiter } from 'bun-rate-limiter';

// Create a queue with concurrency limit and rate limiting
const queue = new RateLimiter({
  concurrency: 5,    // Max 5 concurrent tasks
  limits: {
    minDelayMs: 100, // 100ms minimum between task starts
  },
});

// Add tasks
const result = await queue.add(async () => {
  const response = await fetch('https://api.example.com/data');
  return response.json();
});

// Add with priority (higher = runs first)
await queue.add(async () => 'important!', { priority: 10 });

// Add multiple tasks
const results = await queue.addAll([
  async () => fetchUser(1),
  async () => fetchUser(2),
  async () => fetchUser(3),
]);
```

## Common Recipes

### Anti-burst only (smooth out traffic)
```typescript
const limiter = new RateLimiter({
  concurrency: 10,
  limits: { minDelayMs: 100 }, // Max 10 req/sec, evenly spaced
});
```

### Hard cap per interval
```typescript
const limiter = new RateLimiter({
  concurrency: 10,
  limits: { interval: { limit: 100, interval: 1000 } }, // Max 100/sec, can burst
});
```

### Burst + steady state (token bucket)
```typescript
const limiter = new RateLimiter({
  concurrency: 20,
  limits: {
    tokenBucket: { capacity: 50, refillAmount: 10, refillInterval: 1000 },
  },
}); // Burst 50, then 10/sec steady
```

### Per-user rate limits (distributed)
```typescript
const limiter = new RateLimiter({
  concurrency: 50,
  backend: { type: 'redis', redis: redisClient, keyPrefix: 'myapp:rl' },
  limits: { tokenBucket: { capacity: 100, refillAmount: 100, refillInterval: 60_000 } },
});

// Each user gets their own bucket
await limiter.add(() => fetchUserData(userId), { rateLimitKey: `user:${userId}` });
```

## Core Concepts

### Throttlers

A **throttler** answers: "How long should we wait before starting the next task?" This library provides three types:

| Throttler | Use Case | Example |
|-----------|----------|---------|
| **Spacing** | Anti-burst pacing | "At least 100ms between requests" |
| **Interval** | Hard cap per window | "Max 100 requests per second" |
| **Token Bucket** | Burst + steady state | "Allow 50 burst, then 10/sec refill" |

Each has a local (in-memory) and distributed (Redis) variant.

### Composition

Throttlers **compose** by taking the maximum delay. If you combine a spacing throttler (100ms) with an interval throttler (10/sec), both constraints apply—you get at most 10/sec AND at least 100ms apart.

```typescript
// This enforces BOTH: max 10/sec AND 100ms minimum spacing
const limiter = new RateLimiter({
  concurrency: 10,
  throttlers: [
    new IntervalThrottler({ limit: 10, interval: 1000 }),
    new SpacingThrottler(100),
  ],
});
```

### The `limits` Shorthand

The `limits` option is syntactic sugar that creates throttlers for you:

| `limits` config | Creates |
|-----------------|---------|
| `{ minDelayMs: 100 }` | `SpacingThrottler(100)` |
| `{ interval: { limit: 10, interval: 1000 } }` | `IntervalThrottler(...)` |
| `{ tokenBucket: { capacity: 50, ... } }` | `TokenBucketThrottler(...)` |

When you add `backend: { type: 'redis' }`, the same `limits` config creates Redis-backed throttlers instead (for distributed rate limiting).

### Choosing Between Token Bucket and Interval

| Strategy | Best For | Behavior |
|----------|----------|----------|
| **Token Bucket** | API rate limits with burst allowance | Allows burst up to capacity, then steady refill |
| **Interval** | Hard caps per time window | Strict "N requests per X seconds" |

**For distributed (Redis) limiting:** Use token bucket. Interval is local-only because distributed interval tracking requires complex coordination that adds latency without significant benefit over token bucket.

## API

### `new RateLimiter(options?)`

Create a new queue instance.

```typescript
interface RateLimiterOptions {
  concurrency?: number;   // Max concurrent tasks (default: 1)
  limits?: RateLimiterLimits; // Happy-path rate limiting config
  backend?: BackendOptions; // Optional distributed backend (e.g. Redis)
  throttlers?: IThrottler[]; // Advanced: manual sync throttlers
  asyncThrottlers?: IAsyncThrottler[]; // Advanced: manual async throttlers (e.g. Redis)
  compose?: boolean;      // Combine limits with manual throttlers (default: false)
  defaultRateLimitKey?: string; // Default key for tasks without rateLimitKey
  autoStart?: boolean;    // Start processing immediately (default: true)
  timeout?: number;       // Default timeout in ms for all tasks (default: none)
}

// Rate limiting configuration (tokenBucket and interval are mutually exclusive)
type RateLimiterLimits =
  | { minDelayMs?: number; tokenBucket?: TokenBucketLimits; interval?: never }
  | { minDelayMs?: number; interval?: IntervalLimits; tokenBucket?: never };

interface TokenBucketLimits {
  capacity: number;       // Max tokens (burst size)
  refillAmount: number;   // Tokens added per interval
  refillInterval: number; // Refill period in ms
}

interface IntervalLimits {
  limit: number;          // Max operations per interval
  interval: number;       // Time window in ms
}

// Backend configuration for distributed rate limiting
interface BackendOptions {
  type: 'redis';
  redis: IRedisClient;    // Your Redis client instance
  keyPrefix?: string;     // Key prefix (default: 'bun-rate-limiter')
  defaultKey?: string;    // Default rate limit key
}
```

### `queue.add<T>(fn, options?): Promise<T>`

Add a task to the queue.

```typescript
interface TaskOptions {
  priority?: number;      // Higher = runs first (default: 0)
  rateLimitKey?: string;  // Per-key identifier for distributed rate limiting
  signal?: AbortSignal;   // Cancel the task
  timeout?: number;       // Task timeout in ms (overrides default)
}

// Example with timeout
import { TimeoutError } from 'bun-rate-limiter';

try {
  const result = await queue.add(
    async () => {
      const response = await fetch('https://api.example.com/slow');
      return response.json();
    },
    { timeout: 5000 } // 5 second timeout
  );
} catch (error) {
  if (error instanceof TimeoutError) {
    console.log('Task timed out!');
  }
}

// Example with AbortSignal
const controller = new AbortController();
const promise = queue.add(
  async ({ signal }) => {
    // signal is provided to your function
    const response = await fetch(url, { signal });
    return response.json();
  },
  { signal: controller.signal }
);

// Cancel the task
controller.abort();
```

### `queue.addAll<T>(fns, options?): Promise<T[]>`

Add multiple tasks with the same options.

```typescript
const results = await queue.addAll([
  async () => 1,
  async () => 2,
  async () => 3,
], { priority: 5 });
```

### `queue.pause()` / `queue.start()`

Pause and resume the queue. Running tasks will complete.

```typescript
queue.pause();
// ... add tasks while paused ...
queue.start(); // Resume processing
```

### `queue.clear()`

Remove all pending tasks from the queue.

### `queue.resetAsyncThrottlers()`

Reset the state of all async throttlers (e.g., Redis-backed distributed rate limiters). Useful for testing or recovering from stuck state. Does not remove pending tasks.

```typescript
await queue.resetAsyncThrottlers();
```

### Properties

- `queue.size` - Number of tasks waiting in the queue
- `queue.pending` - Number of tasks currently running (matches p-queue convention)
- `queue.runningCount` - Alias for pending
- `queue.isPaused` - Whether the queue is paused
- `queue.isRateLimited` - Whether the queue is currently rate limited
- `queue.isSaturated` - Whether the queue is at capacity (concurrency OR rate limited)

### Events

Subscribe to queue lifecycle events with `on()`, `once()`, or unsubscribe with `off()`.

```typescript
// Subscribe to events (returns unsubscribe function)
const unsubscribe = queue.on('idle', () => console.log('All done!'));

// Queue starts processing
queue.on('active', () => console.log('Processing started'));

// Task added
queue.on('add', () => console.log('Task added'));

// Task completed
queue.on('completed', (result) => console.log('Completed:', result));

// Task failed
queue.on('error', (error) => console.error('Error:', error));

// Subscribe once (auto-unsubscribes after first event)
queue.once('idle', () => console.log('First idle!'));

// Unsubscribe manually
const handler = () => console.log('active');
queue.on('active', handler);
queue.off('active', handler); // Remove specific handler

// Or use the returned unsubscribe function
unsubscribe();
```

## Advanced Usage

### Custom Throttlers

#### Built-in throttlers (what they do)

This library ships with a few built-in throttling strategies. Each one answers the question: “How long should we wait before starting the next job?”

- **`SpacingThrottler(minDelayMs)`**: enforces a minimum delay between job starts (anti-burst pacing).
  - Good for APIs that require "at least X ms between requests".
  - Note: `RateLimiter({ limits: { minDelayMs } })` internally creates a `SpacingThrottler` when no backend is specified, or a `RedisSpacingThrottler` when using the Redis backend.

- **`IntervalThrottler({ limit, interval })`**: caps the number of job starts in a moving time window (e.g. “no more than 10 per second”).
  - Good for hard “N requests per interval” limits.

- **`TokenBucketThrottler({ capacity, refillAmount, refillInterval, initialTokens? })`**: allows bursts up to `capacity`, then refills over time. Optional `initialTokens` sets starting token count (defaults to `capacity`).
  - Good when you want “burst + steady state” behavior (smoother than a hard window).

- **`RedisSpacingThrottler({ redis, minDelayMs, keyPrefix?, defaultKey?, keyFn? })`** (async throttler): like `SpacingThrottler`, but coordinated via Redis for distributed rate limiting. Optional params: `keyPrefix` (default: `'bun-rate-limiter'`), `defaultKey`, `keyFn` (custom key derivation function).
  - Good when you need true global minimum delay across multiple processes/servers.

- **`RedisTokenBucketThrottler({ redis, capacity, refillAmount, refillInterval, keyPrefix?, defaultKey?, keyFn? })`** (async throttler): like `TokenBucketThrottler`, but coordinated via Redis for distributed rate limiting. Same optional params as `RedisSpacingThrottler`.
  - Good when you have multiple Bun processes/servers that must share a global/per-key limit.

Use the built-in `IntervalThrottler` for rate limiting (e.g., 10 requests per second):

```typescript
import {
  RateLimiter,
  StandardScheduler,
  PriorityQueue,
  IntervalThrottler,
  Job
} from 'bun-rate-limiter';

// Create custom throttler: max 10 jobs per 1000ms
const throttler = new IntervalThrottler({ limit: 10, interval: 1000 });

// Create queue with custom scheduler
const queue = new PriorityQueue<Job<unknown>>((a, b) => b.priority - a.priority);
const scheduler = new StandardScheduler(queue, [throttler], {
  concurrency: 10,
  autoStart: true
});
```

You can also plug throttlers directly into `RateLimiter`:

```typescript
import { RateLimiter, TokenBucketThrottler } from 'bun-rate-limiter';

// Allow bursts of up to 10, refilling at 10 tokens per second
const queue = new RateLimiter({
  concurrency: 10,
  throttlers: [
    new TokenBucketThrottler({
      capacity: 10,
      refillAmount: 10,
      refillInterval: 1000,
    }),
  ],
});
```

#### Composing Throttlers

`throttlers` are composable. The scheduler consults all throttlers and enforces the most restrictive delay:

- Before starting a job, it calls `getNextRunDelay()` on every throttler and waits the **maximum** delay returned.
- When a job starts, it calls `notifyJobStarted()` on every throttler so each strategy can update its own state.

If multiple throttlers “conflict”, the result is simply stricter rate limiting (the intersection of policies). For example:

```typescript
import { RateLimiter, IntervalThrottler, SpacingThrottler } from 'bun-rate-limiter';

const queue = new RateLimiter({
  concurrency: 10,
  throttlers: [
    new IntervalThrottler({ limit: 10, interval: 1000 }), // <= 10/sec
    new SpacingThrottler(100), // >= 100ms between starts
  ],
});
```

#### Composition patterns (why you might do this)

- **Anti-burst pacing only** (simple “don’t spike”): use `limits.minDelayMs` or `SpacingThrottler`.
- **Hard cap only** (“N per interval”): use `IntervalThrottler`.
- **Burst + steady state** (“allow bursts, then smooth out”): use `TokenBucketThrottler`.
- **Hard cap + pacing** (common for flaky APIs): combine `IntervalThrottler` + `SpacingThrottler` so you avoid bursts *and* respect a strict maximum.
- **Distributed limits**: add one or more `asyncThrottlers` (e.g. Redis token bucket) so multiple processes share the same limit; you can still combine with local sync throttlers for extra smoothing.

Note: a throttler that always returns a positive delay (or a very large delay) can effectively stall the queue.

#### How `limits` and `backend` interact

The `limits` option provides a simple way to configure rate limiting without manually instantiating throttlers:

| Configuration | What happens |
|--------------|--------------|
| `limits` only | Creates in-memory (sync) throttlers |
| `limits` + `backend: { type: 'redis' }` | Creates Redis-backed (async) throttlers only* |
| `throttlers`/`asyncThrottlers` only | Uses your manual throttlers directly |
| `limits` + manual throttlers + `compose: true` | Combines both (advanced) |

When you specify both `limits` and manual `throttlers`/`asyncThrottlers` without `compose: true`, the library throws an error to prevent accidental double-throttling. Set `compose: true` to explicitly opt-in to combining them.

*\*Note: `limits.interval` is not supported with the Redis backend (throws error). Use `limits.tokenBucket` for distributed rate limiting.*

### Distributed (Redis) Throttlers

For distributed rate limiting across multiple processes/servers, you have two options:
- **Simple:** Use `limits` + `backend: { type: 'redis' }` (recommended for most cases)
- **Advanced:** Manually configure `asyncThrottlers` for full control

Prerequisites:
- A running Redis instance
- Bun `>= 1.3.0` (for Bun’s `RedisClient`)

#### Global minimum spacing (Redis)

Local `SpacingThrottler` (and `limits.minDelayMs` without a backend) is per-process. If you need a true global minimum delay between starts across multiple processes, use the Redis backend:

```typescript
import { RedisClient } from 'bun';
import { RateLimiter } from 'bun-rate-limiter';

const redis = new RedisClient(process.env.REDIS_URL);
await redis.connect();

const queue = new RateLimiter({
  concurrency: 50,
  backend: { type: 'redis', redis, keyPrefix: 'myapp:rl' },
  limits: { minDelayMs: 3 },
});

await queue.add(async () => fetch(url), { rateLimitKey: 'global' });
```

#### Combining global spacing + global limit

To enforce both “at least 3ms between starts” and “<= 2000 per minute” globally, compose two async throttlers:

```typescript
import { RedisClient } from 'bun';
import { RateLimiter } from 'bun-rate-limiter';

const redis = new RedisClient(process.env.REDIS_URL);
await redis.connect();

const queue = new RateLimiter({
  concurrency: 50,
  backend: { type: 'redis', redis, keyPrefix: 'myapp:rl' },
  limits: {
    minDelayMs: 3,
    tokenBucket: { capacity: 2000, refillAmount: 2000, refillInterval: 60_000 },
  },
});
```

Example: Redis token bucket with per-user keys:

```typescript
import { RedisClient } from 'bun';
import { RateLimiter, RedisTokenBucketThrottler } from 'bun-rate-limiter';

const redis = new RedisClient(process.env.REDIS_URL);
await redis.connect();

const queue = new RateLimiter({
  concurrency: 5,
  asyncThrottlers: [
    new RedisTokenBucketThrottler({
      redis,
      keyPrefix: 'myapp:rl:',
      capacity: 10,
      refillAmount: 10,
      refillInterval: 1000,
    }),
  ],
});

await queue.add(async () => fetchUser(123), { rateLimitKey: 'user:123' });
```

Notes:
- `rateLimitKey` controls the "bucket" a task consumes from (per-user, per-org, global, etc).
- Use `defaultRateLimitKey` in `RateLimiterOptions` to set a default key for all tasks (e.g., `'global'`).
- `asyncThrottlers` are composable; delays are combined by taking the maximum, same as sync throttlers.
- To explicitly reset distributed throttler state (without clearing pending tasks): `await queue.resetAsyncThrottlers()`.
- Example code you can run locally: `examples/simple-redis-token-bucket.ts` or `examples/monorepo/README.md`.

### Using with Node.js

The library works out of the box with Node.js 18+. For Redis-backed rate limiting, you'll need to adapt your Redis client to the `IRedisClient` interface:

#### ioredis adapter

```typescript
import Redis from 'ioredis';
import { RateLimiter, type IRedisClient } from 'bun-rate-limiter';

const redis = new Redis(process.env.REDIS_URL);

// Adapter: ioredis -> IRedisClient
const redisClient: IRedisClient = {
  send: (command, args) => redis.call(command, ...args) as Promise<unknown>,
};

const limiter = new RateLimiter({
  backend: { type: 'redis', redis: redisClient, keyPrefix: 'myapp:rl' },
  limits: { minDelayMs: 30, tokenBucket: { capacity: 2000, refillAmount: 2000, refillInterval: 60_000 } },
});
```

#### node-redis adapter

```typescript
import { createClient } from 'redis';
import { RateLimiter, type IRedisClient } from 'bun-rate-limiter';

const redis = createClient({ url: process.env.REDIS_URL });
await redis.connect();

// Adapter: node-redis -> IRedisClient
const redisClient: IRedisClient = {
  send: (command, args) => redis.sendCommand([command, ...args.map(String)]),
};
```

#### Serverless considerations

In serverless environments (Vercel, AWS Lambda), each invocation may create a new instance. Use a singleton pattern to reuse connections within a container's lifetime:

```typescript
let limiter: RateLimiter | null = null;

export async function getRateLimiter(): Promise<RateLimiter> {
  if (limiter) return limiter;
  // Create once per container lifetime
  const redis = createClient({ url: process.env.REDIS_URL });
  await redis.connect();
  limiter = new RateLimiter({ backend: { type: 'redis', redis: adapter, ... }, ... });
  return limiter;
}
```

The rate limit state lives in Redis, so it's automatically shared across all serverless instances.

See full examples:
- `examples/node-ioredis/` - Simple Node.js + ioredis example
- `examples/nextjs-server-action/` - Next.js 16 server action with Vercel deployment

### Using ArrayQueue (FIFO)

For simple FIFO ordering without priorities:

```typescript
import { ArrayQueue, StandardScheduler, Job } from 'bun-rate-limiter';

const queue = new ArrayQueue<Job<unknown>>();
const scheduler = new StandardScheduler(queue, [], { concurrency: 3 });
```

## Architecture

bun-rate-limiter uses a modular, component-based architecture:

```
RateLimiter (Facade)
    |
    +-- StandardScheduler (Coordinator)
    |       |
    |       +-- IQueue (Storage Strategy)
    |       |     +-- ArrayQueue (FIFO)
    |       |     +-- PriorityQueue (Priority-based)
    |       |
    |       +-- IThrottler[] (Rate Limiting)
    |       |     +-- SpacingThrottler (Min delay between tasks)
    |       |     +-- IntervalThrottler (N tasks per interval)
    |       |     +-- TokenBucketThrottler (Burst + refill)
    |       |
    |       +-- IAsyncThrottler[] (Distributed Rate Limiting)
    |             +-- RedisSpacingThrottler (Min delay via Redis)
    |             +-- RedisTokenBucketThrottler (Burst + refill via Redis)
    |
    +-- Job (Task Wrapper)
    |
    +-- EventBus (Event Handling)
```

## Limitations

### Error handling

- **Redis failures**: If Redis becomes unavailable during operation, tasks will fail with connection errors. The library does **not** automatically fall back to local rate limiting—you must handle Redis errors in your application.
- **No automatic retries**: Failed tasks are not automatically retried. Use the `error` event to implement your own retry logic.

**Mitigation example** (fail-open pattern):

```typescript
async function rateLimitedApiCall<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await limiter.add(fn);
  } catch (error) {
    if (error instanceof Error && error.message.includes('ECONNREFUSED')) {
      // Redis unavailable: fail open (allow request without rate limiting)
      console.warn('Rate limiter unavailable, proceeding without limit');
      return await fn();
    }
    throw error;
  }
}
```

### Distributed rate limiting caveats

- **Clock skew**: Redis throttlers assume reasonably synchronized clocks. Significant clock drift between servers may cause rate limit inaccuracies.
- **Network latency**: Each rate-limited task requires a Redis round-trip. For very high-frequency operations (>1000/sec per process), local throttlers may be more appropriate.
- **No persistence across Redis restarts**: Token bucket state is stored in Redis keys with TTLs. If Redis restarts, rate limit state resets.

### Testing

- For unit tests, you can use local (non-Redis) throttlers
- For integration tests with Redis, use `queue.resetAsyncThrottlers()` between tests to clear state
- The library doesn't provide built-in time mocking; use your test framework's timer mocks

### Not included

- **Sliding window log**: Only fixed window (interval) and token bucket algorithms are included
- **Rate limit headers**: No built-in HTTP header generation (X-RateLimit-Remaining, etc.)—implement in your middleware
- **Metrics/observability**: No built-in Prometheus/StatsD integration; use events for custom metrics

## License

MIT
