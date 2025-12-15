/**
 * Interface for queue storage strategies.
 * Implementations can provide different ordering behaviors (FIFO, priority, etc.)
 */
export interface IQueue<T> {
  /** Current number of items in the queue */
  readonly size: number;

  /** Add an item to the queue */
  enqueue(item: T): void;

  /** Remove and return the next item, or undefined if empty */
  dequeue(): T | undefined;

  /** Return the next item without removing it, or undefined if empty */
  peek(): T | undefined;

  /** Remove all items from the queue */
  clear(): void;
}
