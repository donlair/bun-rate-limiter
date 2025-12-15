# Monorepo demo (Bun workspaces)

This demo shows two independent apps sharing a single Redis-backed rate limiter to call an API without triggering `429` responses.

## What’s inside

- `packages/shared-limiter`: creates a Redis-backed limiter (global min spacing + global token bucket)
- `apps/api`: toy API that enforces two limits:
  - `429` if it receives **5 requests within 5ms**
  - `429` if it receives **more than 20 requests within 1s**
- `apps/client-a` / `apps/client-b`: call the API through the shared limiter

## Run

From `examples/monorepo`:

```bash
docker compose up -d
export REDIS_URL=redis://localhost:6379
export API_URL=http://localhost:3000

bun install
bun run demo:api
```

In two other terminals:

```bash
bun run demo:client-a
```

```bash
bun run demo:client-b
```

## Tests

```bash
docker compose up -d
export REDIS_URL=redis://localhost:6379
bun test demo-tests
```
