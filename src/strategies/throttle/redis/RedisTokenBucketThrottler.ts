import type {
  AcquireContext,
  AcquireResult,
  IAsyncThrottler,
  ThrottlePermit,
} from '../IAsyncThrottler';
import type { IRedisClient } from './IRedisClient';

export interface RedisTokenBucketThrottlerOptions {
  redis: IRedisClient;
  /** Key prefix for bucket state in Redis */
  keyPrefix?: string;
  /** Default key when no per-task key is provided */
  defaultKey?: string;
  /** Maximum number of tokens that can accumulate (burst size). */
  capacity: number;
  /** Tokens added every refill interval. */
  refillAmount: number;
  /** Refill interval in milliseconds. */
  refillInterval: number;
  /**
   * Resolve a per-key identifier for rate limiting.
   * If not provided, uses `context.key ?? context.job.rateLimitKey ?? defaultKey`.
   */
  keyFn?: (context: AcquireContext) => string | undefined;
}

const ACQUIRE_SCRIPT = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refillAmount = tonumber(ARGV[2])
local refillInterval = tonumber(ARGV[3])
local cost = tonumber(ARGV[4])
local ttlMs = tonumber(ARGV[5])

local t = redis.call('TIME')
local nowMs = (t[1] * 1000) + math.floor(t[2] / 1000)

local tokens = tonumber(redis.call('HGET', key, 'tokens'))
local last = tonumber(redis.call('HGET', key, 'ts'))

if tokens == nil then
  tokens = capacity
end

if last == nil then
  last = nowMs
end

local elapsed = nowMs - last
if elapsed > 0 then
  local ratePerMs = refillAmount / refillInterval
  tokens = math.min(capacity, tokens + (elapsed * ratePerMs))
  last = nowMs
end

if tokens >= cost then
  tokens = tokens - cost
  redis.call('HSET', key, 'tokens', tokens, 'ts', last)
  redis.call('PEXPIRE', key, ttlMs)
  return { 1, 0 }
else
  local ratePerMs = refillAmount / refillInterval
  local needed = cost - tokens
  local delayMs = math.ceil(needed / ratePerMs)
  redis.call('HSET', key, 'tokens', tokens, 'ts', last)
  redis.call('PEXPIRE', key, ttlMs)
  return { 0, delayMs }
end
`;

const RELEASE_SCRIPT = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refillAmount = tonumber(ARGV[2])
local refillInterval = tonumber(ARGV[3])
local cost = tonumber(ARGV[4])
local ttlMs = tonumber(ARGV[5])

local t = redis.call('TIME')
local nowMs = (t[1] * 1000) + math.floor(t[2] / 1000)

local tokens = tonumber(redis.call('HGET', key, 'tokens'))
local last = tonumber(redis.call('HGET', key, 'ts'))

if tokens == nil then
  tokens = capacity
end

if last == nil then
  last = nowMs
end

local elapsed = nowMs - last
if elapsed > 0 then
  local ratePerMs = refillAmount / refillInterval
  tokens = math.min(capacity, tokens + (elapsed * ratePerMs))
  last = nowMs
end

tokens = math.min(capacity, tokens + cost)
redis.call('HSET', key, 'tokens', tokens, 'ts', last)
redis.call('PEXPIRE', key, ttlMs)
return 1
`;

export class RedisTokenBucketThrottler implements IAsyncThrottler {
  private readonly redis: IRedisClient;
  private readonly keyPrefix: string;
  private readonly defaultKey: string;

  readonly capacity: number;
  readonly refillAmount: number;
  readonly refillInterval: number;
  private readonly keyFn?: (context: AcquireContext) => string | undefined;

  constructor(options: RedisTokenBucketThrottlerOptions) {
    if (options.capacity <= 0) {
      throw new RangeError('RedisTokenBucketThrottler: capacity must be > 0');
    }
    if (options.refillAmount <= 0) {
      throw new RangeError('RedisTokenBucketThrottler: refillAmount must be > 0');
    }
    if (options.refillInterval <= 0) {
      throw new RangeError('RedisTokenBucketThrottler: refillInterval must be > 0');
    }

    this.redis = options.redis;
    this.keyPrefix = options.keyPrefix ?? 'bun-rate-limiter:token-bucket:';
    this.defaultKey = options.defaultKey ?? 'default';
    this.capacity = options.capacity;
    this.refillAmount = options.refillAmount;
    this.refillInterval = options.refillInterval;
    this.keyFn = options.keyFn;
  }

  async acquire(context: AcquireContext): Promise<AcquireResult> {
    const resolvedKey =
      this.keyFn?.(context) ?? context.key ?? context.job.rateLimitKey ?? this.defaultKey;
    const redisKey = `${this.keyPrefix}${resolvedKey}`;
    const cost = 1;
    const ttlMs = this.getTtlMs();

    const result = await this.redis.send('EVAL', [
      ACQUIRE_SCRIPT,
      '1',
      redisKey,
      String(this.capacity),
      String(this.refillAmount),
      String(this.refillInterval),
      String(cost),
      String(ttlMs),
    ]);

    const parsed = this.parseResult(result);
    if (!parsed.granted) {
      return parsed;
    }

    const permit: ThrottlePermit = this.createPermit(redisKey, cost, ttlMs);
    return { granted: true, permit };
  }

  private createPermit(redisKey: string, cost: number, ttlMs: number): ThrottlePermit {
    let released = false;

    return {
      release: async () => {
        if (released) {
          return;
        }
        released = true;
        await this.redis.send('EVAL', [
          RELEASE_SCRIPT,
          '1',
          redisKey,
          String(this.capacity),
          String(this.refillAmount),
          String(this.refillInterval),
          String(cost),
          String(ttlMs),
        ]);
      },
    };
  }

  private parseResult(result: unknown): AcquireResult {
    if (!Array.isArray(result) || result.length < 2) {
      throw new TypeError('RedisTokenBucketThrottler: expected [granted, delayMs] array from EVAL');
    }

    const grantedRaw = result[0];
    const delayRaw = result[1];

    const granted = typeof grantedRaw === 'number' ? grantedRaw === 1 : grantedRaw === true;
    const delayMs = typeof delayRaw === 'number' ? delayRaw : Number(delayRaw);

    if (granted) {
      return { granted: true };
    }

    return { granted: false, delayMs: Math.max(0, Math.ceil(delayMs)) };
  }

  private getTtlMs(): number {
    const refillToFullMs = (this.capacity / this.refillAmount) * this.refillInterval;
    // Keep the bucket state around long enough to cover idle periods without unbounded key growth.
    // 2x refill-to-full gives time for natural refills; +1000ms avoids edge expiry around boundaries.
    const ttlMs = Math.ceil(refillToFullMs * 2) + 1000;
    return Math.max(ttlMs, this.refillInterval);
  }
}
