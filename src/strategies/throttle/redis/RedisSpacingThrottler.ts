import type {
  AcquireContext,
  AcquireResult,
  IAsyncThrottler,
  ThrottlePermit,
} from '../IAsyncThrottler';
import type { IRedisClient } from './IRedisClient';

export interface RedisSpacingThrottlerOptions {
  redis: IRedisClient;
  /** Key prefix for spacing state in Redis */
  keyPrefix?: string;
  /** Default key when no per-task key is provided */
  defaultKey?: string;
  /** Minimum delay between starts in milliseconds */
  minDelayMs: number;
  /**
   * Resolve a per-key identifier for spacing.
   * If not provided, uses `context.key ?? context.job.rateLimitKey ?? defaultKey`.
   */
  keyFn?: (context: AcquireContext) => string | undefined;
}

/**
 * Lua script that acquires a spacing permit from Redis.
 * Returns [1, acquiredAtMs, previousMs] if granted, or [0, delayMs] if denied.
 * The script checks if enough time has elapsed since the last acquisition.
 */
const ACQUIRE_SCRIPT = `
local key = KEYS[1]
local minDelayMs = tonumber(ARGV[1])
local ttlMs = tonumber(ARGV[2])

local t = redis.call('TIME')
local nowMs = (t[1] * 1000) + math.floor(t[2] / 1000)

local last = tonumber(redis.call('GET', key))
if last == nil then
  last = 0
end

local nextAllowed = last + minDelayMs
if nowMs < nextAllowed then
  return { 0, nextAllowed - nowMs }
end

redis.call('SET', key, nowMs, 'PX', ttlMs)
return { 1, nowMs, last }
`;

/**
 * Lua script that releases a spacing permit, rolling back state in Redis.
 * Returns 1 if the rollback was successful (state matched), 0 otherwise.
 */
const RELEASE_SCRIPT = `
local key = KEYS[1]
local expected = tonumber(ARGV[1])
local previous = tonumber(ARGV[2])
local ttlMs = tonumber(ARGV[3])

local current = tonumber(redis.call('GET', key))
if current == expected then
  if previous == nil or previous == 0 then
    redis.call('DEL', key)
    return 1
  end
  redis.call('SET', key, previous, 'PX', ttlMs)
  return 1
end

return 0
`;

/**
 * Redis-backed spacing throttler that enforces a minimum delay between task starts.
 * Uses distributed state in Redis to coordinate across multiple processes.
 */
export class RedisSpacingThrottler implements IAsyncThrottler {
  private readonly redis: IRedisClient;
  private readonly keyPrefix: string;
  private readonly defaultKey: string;
  private readonly keyFn?: (context: AcquireContext) => string | undefined;

  readonly minDelayMs: number;

  constructor(options: RedisSpacingThrottlerOptions) {
    if (options.minDelayMs <= 0) {
      throw new RangeError('RedisSpacingThrottler: minDelayMs must be > 0');
    }

    this.redis = options.redis;
    this.keyPrefix = options.keyPrefix ?? 'bun-rate-limiter:spacing:';
    this.defaultKey = options.defaultKey ?? 'default';
    this.minDelayMs = options.minDelayMs;
    this.keyFn = options.keyFn;
  }

  /**
   * Attempts to acquire a spacing permit for a task.
   *
   * @param context - The acquire context containing job and key information
   * @returns Promise resolving to an acquire result indicating whether the permit was granted
   */
  async acquire(context: AcquireContext): Promise<AcquireResult> {
    const resolvedKey =
      this.keyFn?.(context) ?? context.key ?? context.job.rateLimitKey ?? this.defaultKey;
    const redisKey = `${this.keyPrefix}${resolvedKey}`;
    const ttlMs = this.getTtlMs();

    const result = await this.redis.send('EVAL', [
      ACQUIRE_SCRIPT,
      1,
      redisKey,
      String(this.minDelayMs),
      String(ttlMs),
    ]);

    const parsed = this.parseResult(result);
    if (!parsed.granted) {
      return parsed;
    }

    const permit: ThrottlePermit = {
      release: async () => {
        await this.redis.send('EVAL', [
          RELEASE_SCRIPT,
          1,
          redisKey,
          String(parsed.acquiredAtMs),
          String(parsed.previousMs),
          String(ttlMs),
        ]);
      },
    };

    return { granted: true, permit };
  }

  /**
   * Parses the Redis EVAL result from the acquire script.
   *
   * @param result - The raw result from Redis EVAL command
   * @returns Parsed acquire result with grant status and timing information
   */
  private parseResult(
    result: unknown,
  ):
    | { granted: true; acquiredAtMs: number; previousMs: number }
    | { granted: false; delayMs: number } {
    if (!Array.isArray(result) || result.length < 2) {
      throw new TypeError('RedisSpacingThrottler: expected [granted, delayMs] array from EVAL');
    }

    const grantedRaw = result[0];
    const value1 = result[1];

    const granted = typeof grantedRaw === 'number' ? grantedRaw === 1 : grantedRaw === true;
    if (!granted) {
      const delayMs = typeof value1 === 'number' ? value1 : Number(value1);
      return { granted: false, delayMs: Math.max(0, Math.ceil(delayMs)) };
    }

    const acquiredAtMs = typeof value1 === 'number' ? value1 : Number(value1);
    const previousRaw = result[2] ?? 0;
    const previousMs = typeof previousRaw === 'number' ? previousRaw : Number(previousRaw);
    return { granted: true, acquiredAtMs, previousMs };
  }

  /**
   * Calculates the TTL for Redis keys.
   *
   * @returns TTL in milliseconds
   */
  private getTtlMs(): number {
    return Math.max(1000, this.minDelayMs * 10);
  }
}
