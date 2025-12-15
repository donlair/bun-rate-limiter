// biome-ignore lint/suspicious/noExplicitAny: Generic event handler requires any[] for flexibility
type EventHandler = (...args: any[]) => void;

/**
 * Type-safe event bus for internal event handling.
 * Uses a generic type parameter to define the event map.
 */
export class EventBus<TEvents extends Record<string, EventHandler>> {
  private listeners: Map<keyof TEvents, Set<TEvents[keyof TEvents]>> = new Map();

  /**
   * Subscribe to an event.
   * @param event The event name
   * @param handler The handler function
   * @returns An unsubscribe function
   */
  on<K extends keyof TEvents>(event: K, handler: TEvents[K]): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    // biome-ignore lint/style/noNonNullAssertion: Map entry is guaranteed to exist from line above
    this.listeners.get(event)!.add(handler);

    return () => this.off(event, handler);
  }

  /**
   * Subscribe to an event for a single emission.
   * @param event The event name
   * @param handler The handler function
   * @returns An unsubscribe function
   */
  once<K extends keyof TEvents>(event: K, handler: TEvents[K]): () => void {
    const wrappedHandler = ((...args: Parameters<TEvents[K]>) => {
      this.off(event, wrappedHandler as TEvents[K]);
      (handler as (...args: Parameters<TEvents[K]>) => void)(...args);
    }) as TEvents[K];

    return this.on(event, wrappedHandler);
  }

  /**
   * Unsubscribe from an event.
   * @param event The event name
   * @param handler The handler function to remove
   */
  off<K extends keyof TEvents>(event: K, handler: TEvents[K]): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      handlers.delete(handler);
    }
  }

  /**
   * Emit an event with arguments.
   * @param event The event name
   * @param args The arguments to pass to handlers
   */
  emit<K extends keyof TEvents>(event: K, ...args: Parameters<TEvents[K]>): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      for (const handler of handlers) {
        (handler as (...args: Parameters<TEvents[K]>) => void)(...args);
      }
    }
  }

  /**
   * Remove all listeners for an event, or all events if no event specified.
   * @param event Optional event name
   */
  removeAllListeners<K extends keyof TEvents>(event?: K): void {
    if (event !== undefined) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }

  /**
   * Get the number of listeners for an event.
   * @param event The event name
   * @returns The number of listeners
   */
  listenerCount<K extends keyof TEvents>(event: K): number {
    return this.listeners.get(event)?.size ?? 0;
  }
}
