// boundedFetch — caps how many Supabase/PostgREST requests are in flight at once.
//
// Why: dense dashboards (AgentCommandDashboard, business-analytics, book-of-business)
// fire ~70-90 queries on first paint. That burst overwhelmed the connection pooler,
// which returned HTTP 500 on random requests ("Failed to fetch", "liveApps query
// error", blank KPI tiles). Capping concurrency spreads the burst over ~1-2s and
// keeps every request under the pooler's limit — zero data/query changes, the whole
// page just loads reliably instead of flickering.
//
// FIFO semaphore. Forwards `init` untouched so React Query's AbortSignal survives.

const MAX_CONCURRENT = 6;
let active = 0;
const waiters: Array<() => void> = [];

function acquire(): Promise<void> {
  if (active < MAX_CONCURRENT) {
    active++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => waiters.push(resolve));
}

function release(): void {
  active--;
  const next = waiters.shift();
  if (next) {
    active++;
    next();
  }
}

export const boundedFetch: typeof fetch = async (input, init) => {
  // Already-aborted requests skip the queue entirely.
  if (init?.signal?.aborted) return fetch(input, init);
  await acquire();
  try {
    return await fetch(input, init);
  } finally {
    release();
  }
};
