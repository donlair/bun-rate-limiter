/**
 * Error thrown when a job exceeds its timeout.
 */
export class TimeoutError extends Error {
  constructor(message = 'Job timed out') {
    super(message);
    this.name = 'TimeoutError';
  }
}
