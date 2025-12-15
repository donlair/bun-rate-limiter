# bun-rate-limiter

A lightweight, zero-runtime-dependency task scheduler and rate limiter built for Bun.

I built this because `p-queue` didn’t give enough control over throttling rules (this library uses **composable throttlers**), and other popular rate limiters like Bottleneck felt dated for modern Bun-first projects.

Use this if you want:
- A small, type-safe queue/scheduler for running async work with concurrency limits
- Pluggable throttling strategies (spacing, interval, token bucket, and more)
- Optional Redis-backed distributed rate limiting via `asyncThrottlers` (bring your own Redis client)

## Compatibility

- **Runtime:** Bun (>= 1.3.0)
- **Package managers:** bun (recommended), npm, pnpm, yarn
- **Node.js:** not supported (this library is free to use Bun-native APIs)

## Why Bun-only?

This project is intentionally built to take advantage of Bun’s native performance and runtime features (including optional integration with Bun’s Redis client in Bun >= 1.3).

## Features

- **Concurrency Control** - Limit the number of concurrent tasks
- **Rate Limiting** - Enforce minimum delays between task starts (anti-burst)
- **Timeout Support** - Automatic task timeout with TimeoutError
- **Priority Queue** - Higher priority tasks run first
- **AbortSignal Support** - Cancel tasks with standard AbortController
- **Type-Safe Events** - Subscribe to queue lifecycle events
- **Modular Architecture** - Swap out queue and throttle strategies

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
  requestDelay: 100, // 100ms minimum between task starts
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

## API

### `new RateLimiter(options?)`

Create a new queue instance.

```typescript
interface RateLimiterOptions {
  concurrency?: number;   // Max concurrent tasks (default: 1)
  requestDelay?: number;  // Min ms between task starts (default: 0)
  throttlers?: IThrottler[]; // Additional throttlers (default: [])
  asyncThrottlers?: IAsyncThrottler[]; // Async throttlers (e.g. Redis) (default: [])
  autoStart?: boolean;    // Start processing immediately (default: true)
  timeout?: number;       // Default timeout in ms for all tasks (default: none)
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

### Properties

- `queue.size` - Number of tasks waiting in the queue
- `queue.pending` - Number of tasks currently running (matches p-queue convention)
- `queue.runningCount` - Alias for pending
- `queue.isPaused` - Whether the queue is paused
- `queue.isRateLimited` - Whether the queue is currently rate limited
- `queue.isSaturated` - Whether the queue is at capacity (concurrency OR rate limited)

### Events

```typescript
// Queue becomes empty
queue.on('idle', () => console.log('All done!'));

// Queue starts processing
queue.on('active', () => console.log('Processing started'));

// Task added
queue.on('add', () => console.log('Task added'));

// Task completed
queue.on('completed', (result) => console.log('Completed:', result));

// Task failed
queue.on('error', (error) => console.error('Error:', error));
```

## Advanced Usage

### Custom Throttlers

#### Built-in throttlers (what they do)

This library ships with a few built-in throttling strategies. Each one answers the question: “How long should we wait before starting the next job?”

- **`SpacingThrottler(minDelayMs)`**: enforces a minimum delay between job starts (anti-burst pacing).
  - Good for APIs that require “at least X ms between requests”.
  - Note: `RateLimiter({ requestDelay })` is just a convenience that internally adds a `SpacingThrottler(requestDelay)`.

- **`IntervalThrottler({ limit, interval })`**: caps the number of job starts in a moving time window (e.g. “no more than 10 per second”).
  - Good for hard “N requests per interval” limits.

- **`TokenBucketThrottler({ capacity, refillAmount, refillInterval })`**: allows bursts up to `capacity`, then refills over time.
  - Good when you want “burst + steady state” behavior (smoother than a hard window).

- **`RedisTokenBucketThrottler(...)`** (async throttler): like `TokenBucketThrottler`, but coordinated via Redis for distributed rate limiting.
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

- **Anti-burst pacing only** (simple “don’t spike”): use `requestDelay` or `SpacingThrottler`.
- **Hard cap only** (“N per interval”): use `IntervalThrottler`.
- **Burst + steady state** (“allow bursts, then smooth out”): use `TokenBucketThrottler`.
- **Hard cap + pacing** (common for flaky APIs): combine `IntervalThrottler` + `SpacingThrottler` so you avoid bursts *and* respect a strict maximum.
- **Distributed limits**: add one or more `asyncThrottlers` (e.g. Redis token bucket) so multiple processes share the same limit; you can still combine with local sync throttlers for extra smoothing.

Note: a throttler that always returns a positive delay (or a very large delay) can effectively stall the queue.

### Distributed (Redis) Throttlers

For distributed rate limiting across multiple processes/servers, use `asyncThrottlers`.

Prerequisites:
- A running Redis instance
- Bun `>= 1.3.0` (for Bun’s `RedisClient`)

#### Global “requestDelay” (minimum spacing) with Redis

`requestDelay` / `SpacingThrottler` is per-process. If you need a true global minimum delay between starts across multiple processes, use `RedisSpacingThrottler`:

```typescript
import { RedisClient } from 'bun';
import { RateLimiter, RedisSpacingThrottler } from 'bun-rate-limiter';

const redis = new RedisClient(process.env.REDIS_URL);
await redis.connect();

const queue = new RateLimiter({
  concurrency: 50,
  asyncThrottlers: [new RedisSpacingThrottler({ redis, minDelayMs: 3 })],
});

await queue.add(async () => fetch(url), { rateLimitKey: 'global' });
```

#### Combining global spacing + global limit

To enforce both “at least 3ms between starts” and “<= 2000 per minute” globally, compose two async throttlers:

```typescript
import { RedisClient } from 'bun';
import { RateLimiter, RedisSpacingThrottler, RedisTokenBucketThrottler } from 'bun-rate-limiter';

const redis = new RedisClient(process.env.REDIS_URL);
await redis.connect();

const queue = new RateLimiter({
  concurrency: 50,
  asyncThrottlers: [
    new RedisSpacingThrottler({ redis, minDelayMs: 3 }),
    new RedisTokenBucketThrottler({
      redis,
      keyPrefix: 'myapp:rl:',
      capacity: 2000,
      refillAmount: 2000,
      refillInterval: 60_000,
    }),
  ],
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
- `rateLimitKey` controls the “bucket” a task consumes from (per-user, per-org, global, etc).
- `asyncThrottlers` are composable; delays are combined by taking the maximum, same as sync throttlers.
- To explicitly reset distributed throttler state (without clearing pending tasks): `await queue.resetAsyncThrottlers()`.
- Example code you can run locally: `examples/simple-redis-token-bucket.ts` or `examples/monorepo/README.md`.

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
    |             +-- SpacingThrottler (Min delay between tasks)
    |             +-- IntervalThrottler (N tasks per interval)
    |             +-- TokenBucketThrottler (Burst + refill)
    |       +-- IAsyncThrottler[] (Distributed Rate Limiting)
    |             +-- RedisTokenBucketThrottler (Burst + refill via Redis)
    |
    +-- Job (Task Wrapper)
    |
    +-- EventBus (Event Handling)
```

## License

MIT
