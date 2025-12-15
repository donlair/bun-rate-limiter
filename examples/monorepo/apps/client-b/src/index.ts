import { createSharedLimiter } from '@demo/shared-limiter';

export interface ClientRunOptions {
  apiUrl: string;
  redisUrl: string;
  name: string;
  count: number;
}

export async function runClient(options: ClientRunOptions): Promise<number> {
  const shared = await createSharedLimiter({ redisUrl: options.redisUrl });
  try {
    const results = await shared.limiter.addAll(
      Array.from({ length: options.count }, (_, index) => async () => {
        const res = await fetch(`${options.apiUrl}/data`, {
          headers: { 'x-client': options.name, 'x-index': String(index) },
        });
        if (res.status === 429) {
          return 429;
        }
        await res.json();
        return res.status;
      }),
      { rateLimitKey: 'global' },
    );

    return results.filter((status) => status === 429).length;
  } finally {
    shared.close();
  }
}

if (import.meta.main) {
  const apiUrl = process.env.API_URL ?? 'http://localhost:3000';
  const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
  const count = process.env.COUNT ? Number(process.env.COUNT) : 50;
  const count429 = await runClient({ apiUrl, redisUrl, name: 'client-b', count });
  console.log(`client-b done (429s=${count429})`);
}

