export interface IRedisClient {
  send(command: string, args: readonly (string | number)[]): Promise<unknown>;
}
