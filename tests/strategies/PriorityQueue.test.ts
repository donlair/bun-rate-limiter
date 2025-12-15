import { describe, expect, test } from 'bun:test';
import { PriorityQueue } from '../../src/strategies/queue/PriorityQueue.ts';

interface PriorityItem {
  priority: number;
  value: string;
}

describe('PriorityQueue', () => {
  describe('enqueue', () => {
    test('adds items to the queue', () => {
      const queue = new PriorityQueue<PriorityItem>((a, b) => a.priority - b.priority);

      queue.enqueue({ priority: 1, value: 'low' });
      queue.enqueue({ priority: 2, value: 'medium' });

      expect(queue.size).toBe(2);
    });
  });

  describe('dequeue', () => {
    test('returns higher priority items first', () => {
      const queue = new PriorityQueue<PriorityItem>((a, b) => a.priority - b.priority);

      queue.enqueue({ priority: 1, value: 'low' });
      queue.enqueue({ priority: 3, value: 'high' });
      queue.enqueue({ priority: 2, value: 'medium' });

      expect(queue.dequeue()?.value).toBe('high');
      expect(queue.dequeue()?.value).toBe('medium');
      expect(queue.dequeue()?.value).toBe('low');
    });

    test('maintains FIFO order for same priority', () => {
      const queue = new PriorityQueue<PriorityItem>((a, b) => a.priority - b.priority);

      queue.enqueue({ priority: 1, value: 'first' });
      queue.enqueue({ priority: 1, value: 'second' });
      queue.enqueue({ priority: 1, value: 'third' });

      expect(queue.dequeue()?.value).toBe('first');
      expect(queue.dequeue()?.value).toBe('second');
      expect(queue.dequeue()?.value).toBe('third');
    });

    test('returns undefined when empty', () => {
      const queue = new PriorityQueue<PriorityItem>((a, b) => a.priority - b.priority);

      expect(queue.dequeue()).toBeUndefined();
    });

    test('decreases size after dequeue', () => {
      const queue = new PriorityQueue<PriorityItem>((a, b) => a.priority - b.priority);

      queue.enqueue({ priority: 1, value: 'a' });
      queue.enqueue({ priority: 2, value: 'b' });

      queue.dequeue();
      expect(queue.size).toBe(1);
    });
  });

  describe('peek', () => {
    test('returns highest priority item without removing', () => {
      const queue = new PriorityQueue<PriorityItem>((a, b) => a.priority - b.priority);

      queue.enqueue({ priority: 1, value: 'low' });
      queue.enqueue({ priority: 3, value: 'high' });

      expect(queue.peek()?.value).toBe('high');
      expect(queue.peek()?.value).toBe('high');
      expect(queue.size).toBe(2);
    });

    test('returns undefined when empty', () => {
      const queue = new PriorityQueue<PriorityItem>((a, b) => a.priority - b.priority);

      expect(queue.peek()).toBeUndefined();
    });
  });

  describe('size', () => {
    test('starts at 0', () => {
      const queue = new PriorityQueue<PriorityItem>((a, b) => a.priority - b.priority);
      expect(queue.size).toBe(0);
    });
  });

  describe('clear', () => {
    test('removes all items', () => {
      const queue = new PriorityQueue<PriorityItem>((a, b) => a.priority - b.priority);

      queue.enqueue({ priority: 1, value: 'a' });
      queue.enqueue({ priority: 2, value: 'b' });
      queue.enqueue({ priority: 3, value: 'c' });

      queue.clear();

      expect(queue.size).toBe(0);
      expect(queue.dequeue()).toBeUndefined();
    });
  });

  describe('comparator contract', () => {
    test('treats positive comparator result as higher priority', () => {
      const queue = new PriorityQueue<PriorityItem>((a, b) => {
        if (a.priority === b.priority) return 0;
        return a.priority > b.priority ? 1 : -1;
      });

      queue.enqueue({ priority: 1, value: 'low' });
      queue.enqueue({ priority: 3, value: 'high' });
      queue.enqueue({ priority: 2, value: 'medium' });

      expect(queue.dequeue()?.value).toBe('high');
      expect(queue.dequeue()?.value).toBe('medium');
      expect(queue.dequeue()?.value).toBe('low');
    });
  });

  describe('complex scenarios', () => {
    test('handles mixed priority insertions', () => {
      const queue = new PriorityQueue<PriorityItem>((a, b) => a.priority - b.priority);

      queue.enqueue({ priority: 5, value: 'e' });
      queue.enqueue({ priority: 1, value: 'a' });
      queue.enqueue({ priority: 3, value: 'c' });
      queue.enqueue({ priority: 2, value: 'b' });
      queue.enqueue({ priority: 4, value: 'd' });

      expect(queue.dequeue()?.value).toBe('e');
      expect(queue.dequeue()?.value).toBe('d');
      expect(queue.dequeue()?.value).toBe('c');
      expect(queue.dequeue()?.value).toBe('b');
      expect(queue.dequeue()?.value).toBe('a');
    });

    test('works with negative priorities', () => {
      const queue = new PriorityQueue<PriorityItem>((a, b) => a.priority - b.priority);

      queue.enqueue({ priority: -1, value: 'negative' });
      queue.enqueue({ priority: 0, value: 'zero' });
      queue.enqueue({ priority: 1, value: 'positive' });

      expect(queue.dequeue()?.value).toBe('positive');
      expect(queue.dequeue()?.value).toBe('zero');
      expect(queue.dequeue()?.value).toBe('negative');
    });
  });
});
