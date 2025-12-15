export interface ApiServer {
  url: string;
  stop: () => void;
}

function tryServe(port: number) {
  return Bun.serve({
    port,
    fetch(req) {
      return handleRequest(req);
    },
  });
}

const recentRequestTimesMs: number[] = [];

function handleRequest(req: Request): Response {
  const now = performance.now();
  recentRequestTimesMs.push(now);

  // Prune to last second
  const oneSecondAgo = now - 1000;
  while (recentRequestTimesMs.length > 0 && recentRequestTimesMs[0] < oneSecondAgo) {
    recentRequestTimesMs.shift();
  }

  let countLast5ms = 0;
  for (let index = recentRequestTimesMs.length - 1; index >= 0; index--) {
    if (now - recentRequestTimesMs[index] <= 5) {
      countLast5ms++;
    } else {
      break;
    }
  }

  const countLast1s = recentRequestTimesMs.length;
  const isBursting = countLast5ms >= 5;
  const isOverRps = countLast1s > 20;

  if (isBursting || isOverRps) {
    return new Response(
      JSON.stringify({
        error: 'rate_limited',
        burst5ms: countLast5ms,
        rps1s: countLast1s,
      }),
      { status: 429, headers: { 'content-type': 'application/json' } },
    );
  }

  const url = new URL(req.url);
  if (url.pathname === '/health') {
    return new Response('ok');
  }
  if (url.pathname === '/data') {
    return new Response(JSON.stringify({ ok: true, t: Date.now() }), {
      headers: { 'content-type': 'application/json' },
    });
  }
  return new Response('not found', { status: 404 });
}

/**
 * Toy API that enforces:
 * - 429 if it receives 5 requests within 5ms
 * - 429 if it receives more than 20 requests within 1s
 */
export function startApiServer(options: { port?: number } = {}): ApiServer {
  const port = options.port ?? 3000;
  recentRequestTimesMs.length = 0;

  // Bun doesn't reliably support port=0 as "pick any port", so emulate it.
  const desiredPorts =
    port === 0
      ? Array.from({ length: 20 }, () => 20_000 + Math.floor(Math.random() * 20_000))
      : [port];

  let lastError: unknown = null;
  for (const candidate of desiredPorts) {
    try {
      const server = tryServe(candidate);
      return {
        url: server.url.toString().replace(/\/$/, ''),
        stop: () => server.stop(true),
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));

}

if (import.meta.main) {
  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  const api = startApiServer({ port });
  console.log(`API listening on ${api.url}`);
}
