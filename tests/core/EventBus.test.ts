import { describe, expect, mock, test } from 'bun:test';
import { EventBus } from '../../src/core/EventBus.ts';

describe('EventBus', () => {
  describe('on', () => {
    test('subscribes to events', () => {
      const bus = new EventBus<{ test: () => void }>();
      const handler = mock(() => {});

      bus.on('test', handler);
      bus.emit('test');

      expect(handler).toHaveBeenCalledTimes(1);
    });

    test('returns unsubscribe function', () => {
      const bus = new EventBus<{ test: () => void }>();
      const handler = mock(() => {});

      const unsubscribe = bus.on('test', handler);
      unsubscribe();
      bus.emit('test');

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('once', () => {
    test('subscribes to event only once', () => {
      const bus = new EventBus<{ test: () => void }>();
      const handler = mock(() => {});

      bus.once('test', handler);
      bus.emit('test');
      bus.emit('test');

      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe('emit', () => {
    test('calls all handlers for an event', () => {
      const bus = new EventBus<{ test: () => void }>();
      const handler1 = mock(() => {});
      const handler2 = mock(() => {});

      bus.on('test', handler1);
      bus.on('test', handler2);
      bus.emit('test');

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
    });

    test('passes arguments to handlers', () => {
      const bus = new EventBus<{ test: (a: number, b: string) => void }>();
      const handler = mock(() => {});

      bus.on('test', handler);
      bus.emit('test', 42, 'hello');

      expect(handler).toHaveBeenCalledWith(42, 'hello');
    });

    test('does nothing if no handlers registered', () => {
      const bus = new EventBus<{ test: () => void }>();
      // Should not throw
      expect(() => bus.emit('test')).not.toThrow();
    });
  });

  describe('off', () => {
    test('removes specific handler', () => {
      const bus = new EventBus<{ test: () => void }>();
      const handler1 = mock(() => {});
      const handler2 = mock(() => {});

      bus.on('test', handler1);
      bus.on('test', handler2);
      bus.off('test', handler1);
      bus.emit('test');

      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).toHaveBeenCalledTimes(1);
    });

    test('does nothing if handler not registered', () => {
      const bus = new EventBus<{ test: () => void }>();
      const handler = mock(() => {});

      // Should not throw
      expect(() => bus.off('test', handler)).not.toThrow();
    });
  });

  describe('removeAllListeners', () => {
    test('removes all handlers for an event', () => {
      const bus = new EventBus<{ test: () => void; other: () => void }>();
      const handler1 = mock(() => {});
      const handler2 = mock(() => {});
      const otherHandler = mock(() => {});

      bus.on('test', handler1);
      bus.on('test', handler2);
      bus.on('other', otherHandler);
      bus.removeAllListeners('test');

      bus.emit('test');
      bus.emit('other');

      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).not.toHaveBeenCalled();
      expect(otherHandler).toHaveBeenCalledTimes(1);
    });

    test('removes all handlers for all events when no event specified', () => {
      const bus = new EventBus<{ test: () => void; other: () => void }>();
      const handler1 = mock(() => {});
      const handler2 = mock(() => {});

      bus.on('test', handler1);
      bus.on('other', handler2);
      bus.removeAllListeners();

      bus.emit('test');
      bus.emit('other');

      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).not.toHaveBeenCalled();
    });
  });

  describe('listenerCount', () => {
    test('returns number of listeners for an event', () => {
      const bus = new EventBus<{ test: () => void }>();

      expect(bus.listenerCount('test')).toBe(0);

      bus.on('test', () => {});
      expect(bus.listenerCount('test')).toBe(1);

      bus.on('test', () => {});
      expect(bus.listenerCount('test')).toBe(2);
    });
  });
});
