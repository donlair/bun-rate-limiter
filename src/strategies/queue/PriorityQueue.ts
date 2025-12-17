// biome-ignore-all lint/style/noNonNullAssertion: Heap algorithm uses bounds-checked array access
import type { IQueue } from './IQueue';

/**
 * Comparator function for determining priority order.
 * Should return positive if a should come before b, negative if b should come before a.
 */
export type Comparator<T> = (a: T, b: T) => number;

/**
 * Priority queue implementation using a binary heap.
 * Items with higher priority (as determined by the comparator) are dequeued first.
 * Items with equal priority maintain FIFO order.
 */
export class PriorityQueue<T> implements IQueue<T> {
  private items: Array<{ item: T; insertOrder: number }> = [];
  private insertCounter = 0;

  constructor(private readonly comparator: Comparator<T>) {}

  get size(): number {
    return this.items.length;
  }

  enqueue(item: T): void {
    const entry = { item, insertOrder: this.insertCounter++ };
    this.items.push(entry);
    this.bubbleUp(this.items.length - 1);
  }

  dequeue(): T | undefined {
    if (this.items.length === 0) {
      return undefined;
    }

    const result = this.items[0]!.item;

    const last = this.items.pop();
    if (this.items.length > 0 && last) {
      this.items[0] = last;
      this.bubbleDown(0);
    }

    return result;
  }

  peek(): T | undefined {
    return this.items[0]?.item;
  }

  clear(): void {
    this.items = [];
    this.insertCounter = 0;
  }

  /**
   * Compare two entries, considering both priority and insertion order.
   * Returns positive if a has higher priority than b (should be dequeued first).
   */
  private compare(
    a: { item: T; insertOrder: number },
    b: { item: T; insertOrder: number },
  ): number {
    const priorityCompare = this.comparator(a.item, b.item);
    if (priorityCompare !== 0) {
      return priorityCompare;
    }
    return b.insertOrder - a.insertOrder;
  }

  /**
   * Moves an element up the heap until it reaches its correct position.
   * Used after inserting a new element at the end of the heap.
   *
   * @param index - Starting index to bubble up from
   */
  private bubbleUp(index: number): void {
    const current = this.items[index]!;

    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2);
      const parent = this.items[parentIndex]!;

      if (this.compare(current, parent) <= 0) {
        break;
      }

      this.items[index] = parent;
      index = parentIndex;
    }

    this.items[index] = current;
  }

  /**
   * Moves an element down the heap until it reaches its correct position.
   * Used after removing the root and replacing it with the last element.
   *
   * @param index - Starting index to bubble down from
   */
  private bubbleDown(index: number): void {
    const length = this.items.length;

    while (true) {
      const leftChildIndex = 2 * index + 1;
      const rightChildIndex = 2 * index + 2;
      let largestIndex = index;

      if (
        leftChildIndex < length &&
        this.compare(this.items[leftChildIndex]!, this.items[largestIndex]!) > 0
      ) {
        largestIndex = leftChildIndex;
      }

      if (
        rightChildIndex < length &&
        this.compare(this.items[rightChildIndex]!, this.items[largestIndex]!) > 0
      ) {
        largestIndex = rightChildIndex;
      }

      if (largestIndex === index) {
        break;
      }

      const temp = this.items[index]!;
      this.items[index] = this.items[largestIndex]!;
      this.items[largestIndex] = temp;
      index = largestIndex;
    }
  }
}
