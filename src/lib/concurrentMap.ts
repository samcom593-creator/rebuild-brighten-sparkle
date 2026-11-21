/**
 * Bounded-concurrency map. Runs `fn` over every item with at most `limit`
 * promises in flight at once, preserving input order in the result array.
 *
 * It NEVER rejects: each item resolves to a settled result — `{ ok: true }`
 * or `{ ok: false, error }` — so one failing item cannot abort the batch.
 * Callers tally ok/fail exactly as a sequential `try { … ok++ } catch { fail++ }`
 * loop did, with identical per-row tolerance.
 *
 * Why this exists: admin bulk actions (RecoveryQueue Power-Hour, the Unlicensed
 * queue) fired one `await supabase.rpc(…)` per selected row inside a for-loop.
 * On a 200-row selection that is 200 serial round-trips — ~30s of spinner for an
 * action the operator expects to be instant. Each RPC touches a distinct row id,
 * so there is no lock contention; running them with a small concurrency cap cuts
 * wall-clock roughly `cap`x without a DB migration. The cap matters: an unbounded
 * `Promise.all` of 500 writes would open 500 concurrent requests and exhaust the
 * PostgREST connection pool, trading a slow batch for a failed one.
 */
export type Settled<R> = { ok: true; value: R } | { ok: false; error: unknown };

export async function concurrentMap<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<Settled<R>[]> {
  const results: Settled<R>[] = new Array(items.length);
  let next = 0;
  const cap = Math.max(1, Math.min(Math.floor(limit) || 1, items.length || 1));
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      try {
        results[i] = { ok: true, value: await fn(items[i], i) };
      } catch (error) {
        results[i] = { ok: false, error };
      }
    }
  };
  await Promise.all(Array.from({ length: cap }, worker));
  return results;
}
