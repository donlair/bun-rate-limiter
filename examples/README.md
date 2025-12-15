# Examples

## 1) Simple: Redis-backed throttling

Quick single-file demo showing `RedisTokenBucketThrottler` + `RedisSpacingThrottler`.

```bash
export REDIS_URL=redis://localhost:6379
bun run examples/simple-redis-token-bucket.ts
```

## 2) Monorepo demo: shared limiter across apps

A Bun workspace monorepo with:
- `packages/shared-limiter`: creates a Redis-backed limiter shared by multiple apps
- `apps/api`: a toy API that returns `429` when limits are exceeded
- `apps/client-a` + `apps/client-b`: two clients that call the API through the shared limiter

See `examples/monorepo/README.md`.
