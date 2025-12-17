/**
 * Interface for Redis client capable of sending commands.
 */
export interface IRedisClient {
  /**
   * Sends a Redis command with arguments.
   *
   * @param command - The Redis command to execute
   * @param args - Command arguments
   * @returns Promise resolving to the Redis response
   */
  send(command: string, args: readonly (string | number)[]): Promise<unknown>;
}
