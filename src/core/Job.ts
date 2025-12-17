import { TimeoutError } from './errors';
import type { JobStatus, Task } from './types';

let jobIdCounter = 0;

/**
 * Options for creating a Job
 */
export interface JobOptions {
  /** Priority level (higher = processed first) */
  priority?: number;
  /** Optional per-key identifier for distributed rate limiting */
  rateLimitKey?: string;
  /** External AbortSignal for cancellation */
  signal?: AbortSignal;
  /** Timeout in milliseconds (0 or undefined = no timeout) */
  timeout?: number;
}

/**
 * Job wraps a task function and manages its execution lifecycle.
 * It handles the Promise resolution/rejection and AbortSignal integration.
 */
export class Job<T> {
  /** Unique identifier for this job */
  readonly id: string;
  /** Priority level (higher = processed first) */
  readonly priority: number;
  /** Optional per-key identifier for distributed rate limiting */
  readonly rateLimitKey?: string;
  /** Timeout in milliseconds (0 or undefined = no timeout) */
  readonly timeout?: number;
  /** Current execution status of the job */
  private _status: JobStatus = 'pending';
  /** The task function to execute */
  private readonly fn: Task<T>;
  /** Internal abort controller for cancellation */
  private readonly abortController: AbortController;
  /** External abort signal provided by user */
  private readonly externalSignal?: AbortSignal;
  /** Promise resolver function */
  private resolvePromise!: (value: T) => void;
  /** Promise rejector function */
  private rejectPromise!: (reason: unknown) => void;
  /** Promise that resolves when job completes */
  readonly promise: Promise<T>;

  /**
   * Creates a new Job instance.
   *
   * @param fn - The task function to execute
   * @param options - Job configuration options
   */
  constructor(fn: Task<T>, options: JobOptions = {}) {
    this.id = `job_${++jobIdCounter}_${Date.now()}`;
    this.fn = fn;
    this.priority = options.priority ?? 0;
    this.rateLimitKey = options.rateLimitKey;
    this.timeout = options.timeout;
    this.abortController = new AbortController();
    this.externalSignal = options.signal;

    this.promise = new Promise<T>((resolve, reject) => {
      this.resolvePromise = resolve;
      this.rejectPromise = reject;
    });

    if (this.externalSignal?.aborted) {
      this._status = 'cancelled';
    } else {
      this.externalSignal?.addEventListener('abort', () => {
        this.cancel();
      });
    }
  }

  get status(): JobStatus {
    return this._status;
  }

  /**
   * Cancel this job.
   * If running, the abort signal will be triggered.
   * If pending, the job will be marked as cancelled.
   */
  cancel(): void {
    if (this._status === 'completed' || this._status === 'failed' || this._status === 'cancelled') {
      return;
    }

    const wasPending = this._status === 'pending';
    this._status = 'cancelled';
    this.abortController.abort();

    if (wasPending) {
      const error = new DOMException('Job was cancelled', 'AbortError');
      this.rejectPromise(error);
    }
  }

  /**
   * Execute the job's task function.
   * @returns The result of the task
   * @throws If the task throws, times out, or is cancelled
   */
  async execute(): Promise<T> {
    if (this._status === 'cancelled') {
      const error = new DOMException('Job was cancelled', 'AbortError');
      this.rejectPromise(error);
      throw error;
    }

    this._status = 'running';

    const signal = this.externalSignal
      ? AbortSignal.any([this.abortController.signal, this.externalSignal])
      : this.abortController.signal;

    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    try {
      let result: T;

      if (this.timeout && this.timeout > 0) {
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => {
            this.abortController.abort();
            reject(new TimeoutError(`Job timed out after ${this.timeout}ms`));
          }, this.timeout);
        });

        const abortPromise = this.externalSignal
          ? new Promise<never>((_, reject) => {
              const onAbort = () => {
                reject(new DOMException('Job was cancelled', 'AbortError'));
              };
              if (this.externalSignal?.aborted) {
                onAbort();
              } else {
                this.externalSignal?.addEventListener('abort', onAbort, { once: true });
              }
            })
          : new Promise<never>(() => {});

        result = await Promise.race([this.fn({ signal }), timeoutPromise, abortPromise]);
      } else {
        result = await this.fn({ signal });
      }

      if (this.abortController.signal.aborted) {
        const error = new DOMException('Job was cancelled', 'AbortError');
        this._status = 'cancelled';
        this.rejectPromise(error);
        throw error;
      }

      this._status = 'completed';
      this.resolvePromise(result);
      return result;
    } catch (error) {
      if (error instanceof TimeoutError) {
        this._status = 'failed';
      } else if (this.abortController.signal.aborted) {
        this._status = 'cancelled';
      } else {
        this._status = 'failed';
      }
      this.rejectPromise(error);
      throw error;
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }
}
