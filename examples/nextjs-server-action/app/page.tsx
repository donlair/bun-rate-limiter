'use client';

import { useState, useTransition } from 'react';
import { fetchExternalData, getRateLimiterStatus } from './actions';

export default function Home() {
  const [results, setResults] = useState<string[]>([]);
  const [status, setStatus] = useState<{
    pending: number;
    running: number;
    isRateLimited: boolean;
    isSaturated: boolean;
  } | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleFetch = () => {
    startTransition(async () => {
      const result = await fetchExternalData(`query-${Date.now()}`);
      setResults((prev) => [
        `[${result.timestamp}ms] ${result.data}`,
        ...prev.slice(0, 9),
      ]);
    });
  };

  const handleBurstFetch = () => {
    // Fire 20 requests at once to test rate limiting
    startTransition(async () => {
      const promises = Array.from({ length: 20 }, (_, i) =>
        fetchExternalData(`burst-${i}`)
      );
      const results = await Promise.all(promises);
      setResults(
        results.map((r) => `[${r.timestamp}ms] ${r.data}`).slice(0, 10)
      );
    });
  };

  const handleStatus = () => {
    startTransition(async () => {
      const s = await getRateLimiterStatus();
      setStatus(s);
    });
  };

  return (
    <main style={{ padding: '2rem', fontFamily: 'system-ui' }}>
      <h1>Rate Limiter Demo</h1>
      <p>
        This demo shows distributed rate limiting with bun-rate-limiter in a
        Next.js 16 server action.
      </p>

      <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
        <button onClick={handleFetch} disabled={isPending}>
          {isPending ? 'Loading...' : 'Fetch Data'}
        </button>
        <button onClick={handleBurstFetch} disabled={isPending}>
          {isPending ? 'Loading...' : 'Burst (20 requests)'}
        </button>
        <button onClick={handleStatus} disabled={isPending}>
          Check Status
        </button>
      </div>

      {status && (
        <div
          style={{
            marginTop: '1rem',
            padding: '1rem',
            background: '#f0f0f0',
            borderRadius: '4px',
          }}
        >
          <strong>Rate Limiter Status:</strong>
          <ul>
            <li>Pending: {status.pending}</li>
            <li>Running: {status.running}</li>
            <li>Rate Limited: {status.isRateLimited ? 'Yes' : 'No'}</li>
            <li>Saturated: {status.isSaturated ? 'Yes' : 'No'}</li>
          </ul>
        </div>
      )}

      <div style={{ marginTop: '1rem' }}>
        <strong>Results:</strong>
        <ul>
          {results.map((r, i) => (
            <li key={i} style={{ fontFamily: 'monospace', fontSize: '0.9rem' }}>
              {r}
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
