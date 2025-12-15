# Next.js 16 Server Action Example

This example demonstrates using `bun-rate-limiter` with Next.js 16 server actions for distributed rate limiting on Vercel (or any serverless platform).

## Prerequisites

- Node.js 18+
- Redis server (local or hosted like Upstash, Redis Cloud)

## Setup

```bash
# Install dependencies
npm install

# Set Redis URL (optional - defaults to localhost:6379)
export REDIS_URL="redis://localhost:6379"

# Start Redis locally (if needed)
docker run -d -p 6379:6379 redis:alpine

# Run development server
npm run dev
```

## Deploying to Vercel

1. Set up a Redis database (recommended: [Upstash](https://upstash.com/) for serverless)
2. Add `REDIS_URL` to your Vercel environment variables
3. Deploy: `vercel deploy`

## Key Concepts

### Singleton Pattern for Serverless

In serverless environments, each function invocation may create a new instance. We use a singleton pattern to reuse the Redis connection within a container's lifetime:

```typescript
// app/rate-limiter.ts
let limiter: RateLimiter | null = null;

export async function getRateLimiter(): Promise<RateLimiter> {
  if (limiter) return limiter;
  // Create new instance only once per container
  limiter = new RateLimiter({ ... });
  return limiter;
}
```

### node-redis Adapter

```typescript
import { createClient } from 'redis';

const redis = createClient({ url: process.env.REDIS_URL });
await redis.connect();

const redisClient: IRedisClient = {
  send: (command, args) => redis.sendCommand([command, ...args.map(String)]),
};
```

### Server Action Usage

```typescript
// app/actions.ts
'use server';

import { withRateLimit } from './rate-limiter';

export async function fetchExternalData(query: string) {
  return withRateLimit(async () => {
    const response = await fetch('https://api.example.com/data?q=' + query);
    return response.json();
  });
}
```

## Why This Works for Serverless

1. **Rate limit state is in Redis** - Not in memory, so it survives across serverless invocations
2. **Global coordination** - All Vercel instances share the same Redis state
3. **Cold start safe** - Each new instance creates its own RateLimiter, but they all coordinate via Redis
4. **Connection reuse** - Within a container's lifetime, we reuse the Redis connection

## Configuration

The example uses:
- **2000 requests/minute** - Token bucket capacity
- **30ms anti-burst** - Minimum spacing between requests
- **Global rate limit key** - All requests share one pool

Adjust in `app/rate-limiter.ts` for your needs.
