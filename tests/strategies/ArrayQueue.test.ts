import { describe, expect, test } from 'bun:test';
import { ArrayQueue } from '../../src/strategies/queue/ArrayQueue.ts';

describe('ArrayQueue', () => {
  describe('enqueue', () => {
    test('adds items to the queue', () => {
      const queue = new ArrayQueue<number>();

      queue.enqueue(1);
      queue.enqueue(2);
      queue.enqueue(3);

      expect(queue.size).toBe(3);
    });
  });

  describe('dequeue', () => {
    test('returns items in FIFO order', () => {
      const queue = new ArrayQueue<number>();

      queue.enqueue(1);
      queue.enqueue(2);
      queue.enqueue(3);

      expect(queue.dequeue()).toBe(1);
      expect(queue.dequeue()).toBe(2);
      expect(queue.dequeue()).toBe(3);
    });

    test('returns undefined when empty', () => {
      const queue = new ArrayQueue<number>();

      expect(queue.dequeue()).toBeUndefined();
    });

    test('decreases size after dequeue', () => {
      const queue = new ArrayQueue<number>();

      queue.enqueue(1);
      queue.enqueue(2);
      expect(queue.size).toBe(2);

      queue.dequeue();
      expect(queue.size).toBe(1);

      queue.dequeue();
      expect(queue.size).toBe(0);
    });
  });

  describe('peek', () => {
    test('returns next item without removing it', () => {
      const queue = new ArrayQueue<number>();

      queue.enqueue(1);
      queue.enqueue(2);

      expect(queue.peek()).toBe(1);
      expect(queue.peek()).toBe(1);
      expect(queue.size).toBe(2);
    });

    test('returns undefined when empty', () => {
      const queue = new ArrayQueue<number>();

      expect(queue.peek()).toBeUndefined();
    });
  });

  describe('size', () => {
    test('starts at 0', () => {
      const queue = new ArrayQueue<number>();
      expect(queue.size).toBe(0);
    });

    test('reflects current count', () => {
      const queue = new ArrayQueue<number>();

      queue.enqueue(1);
      expect(queue.size).toBe(1);

      queue.enqueue(2);
      expect(queue.size).toBe(2);

      queue.dequeue();
      expect(queue.size).toBe(1);
    });
  });

  describe('clear', () => {
    test('removes all items', () => {
      const queue = new ArrayQueue<number>();

      queue.enqueue(1);
      queue.enqueue(2);
      queue.enqueue(3);
      expect(queue.size).toBe(3);

      queue.clear();
      expect(queue.size).toBe(0);
      expect(queue.dequeue()).toBeUndefined();
    });
  });

  describe('with objects', () => {
    test('handles object items correctly', () => {
      const queue = new ArrayQueue<{ id: number; name: string }>();

      const obj1 = { id: 1, name: 'first' };
      const obj2 = { id: 2, name: 'second' };

      queue.enqueue(obj1);
      queue.enqueue(obj2);

      expect(queue.dequeue()).toBe(obj1);
      expect(queue.dequeue()).toBe(obj2);
    });
  });
});
