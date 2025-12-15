import type { IQueue } from './IQueue';

/**
 * Simple FIFO queue implementation using an array.
 */
export class ArrayQueue<T> implements IQueue<T> {
  private items: T[] = [];

  get size(): number {
    return this.items.length;
  }

  enqueue(item: T): void {
    this.items.push(item);
  }

  dequeue(): T | undefined {
    return this.items.shift();
  }

  peek(): T | undefined {
    return this.items[0];
  }

  clear(): void {
    this.items = [];
  }
}
