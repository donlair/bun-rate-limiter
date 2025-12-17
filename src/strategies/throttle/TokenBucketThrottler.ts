import type { IThrottler } from './IThrottler';

export interface TokenBucketThrottlerOptions {
  /** Maximum number of tokens that can accumulate (burst size). */
  capacity: number;
  /** Tokens added every refill interval. */
  refillAmount: number;
  /** Refill interval in milliseconds. */
  refillInterval: number;
  /** Initial tokens available (default: capacity). */
  initialTokens?: number;
}

/**
 * Token bucket throttler.
 *
 * - Each job consumes 1 token.
 * - Tokens refill continuously over time up to `capacity`.
 * - When empty, `getNextRunDelay()` returns the time until the next token is available.
 */
export class TokenBucketThrottler implements IThrottler {
  private tokens: number;
  private lastRefillTime: number;

  readonly capacity: number;
  readonly refillAmount: number;
  readonly refillInterval: number;

  constructor(options: TokenBucketThrottlerOptions) {
    if (options.capacity <= 0) {
      throw new RangeError('TokenBucketThrottler: capacity must be > 0');
    }
    if (options.refillAmount <= 0) {
      throw new RangeError('TokenBucketThrottler: refillAmount must be > 0');
    }
    if (options.refillInterval <= 0) {
      throw new RangeError('TokenBucketThrottler: refillInterval must be > 0');
    }

    this.capacity = options.capacity;
    this.refillAmount = options.refillAmount;
    this.refillInterval = options.refillInterval;

    this.tokens = Math.min(this.capacity, options.initialTokens ?? this.capacity);
    this.lastRefillTime = Date.now();
  }

  /**
   * Get the delay before the next job can start.
   *
   * @returns 0 if a token is available, or milliseconds to wait until the next token
   */
  getNextRunDelay(): number {
    this.refill();

    if (this.tokens >= 1) {
      return 0;
    }

    const ratePerMs = this.refillAmount / this.refillInterval;
    const tokensNeeded = 1 - this.tokens;
    const delayMs = tokensNeeded / ratePerMs;

    return Math.max(0, Math.ceil(delayMs));
  }

  /**
   * Notify that a job has started.
   * Consumes one token from the bucket.
   */
  notifyJobStarted(): void {
    this.refill();
    this.tokens = Math.max(0, this.tokens - 1);
  }

  /**
   * Reset the throttler to its initial state.
   * Restores tokens to full capacity and resets the refill timer.
   */
  reset(): void {
    this.tokens = this.capacity;
    this.lastRefillTime = Date.now();
  }

  /**
   * Refills tokens based on elapsed time since the last refill.
   * Called internally before checking token availability.
   */
  private refill(): void {
    const now = Date.now();
    const elapsedMs = now - this.lastRefillTime;
    if (elapsedMs <= 0) {
      return;
    }

    const ratePerMs = this.refillAmount / this.refillInterval;
    this.tokens = Math.min(this.capacity, this.tokens + elapsedMs * ratePerMs);
    this.lastRefillTime = now;
  }
}
