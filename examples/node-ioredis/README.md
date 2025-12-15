# Node.js + ioredis Example

This example demonstrates using `bun-rate-limiter` with Node.js and [ioredis](https://github.com/redis/ioredis) for distributed rate limiting.

## Prerequisites

- Node.js 18+
- Redis server running locally (or set `REDIS_URL`)

## Setup

```bash
# Install dependencies
npm install

# Start Redis (if not running)
docker run -d -p 6379:6379 redis:alpine

# Run the example
npm start
```

## What this demonstrates

1. **IRedisClient Adapter** - How to adapt ioredis to the library's interface:
   ```typescript
   const redisClient: IRedisClient = {
     send: (command, args) => redis.call(command, ...args),
   };
   ```

2. **Distributed Rate Limiting** - 2000 requests/minute + anti-burst:
   ```typescript
   const limiter = new RateLimiter({
     backend: { type: 'redis', redis: redisClient, keyPrefix: 'myapp:rl' },
     limits: {
       minDelayMs: 30,
       tokenBucket: { capacity: 2000, refillAmount: 2000, refillInterval: 60_000 },
     },
   });
   ```

3. **Works on Node.js** - No Bun required at runtime.

## Running multiple instances

Open multiple terminals and run `npm start` in each. All instances will share the same rate limit via Redis.
