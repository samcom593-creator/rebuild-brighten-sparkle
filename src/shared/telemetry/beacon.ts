/**
 * Synchronous unload-safe writer for public.analytics_events — MP-514.
 *
 * WHY THIS EXISTS. Both telemetry writers flushed their terminal batch through
 * `await import("@/integrations/supabase/client")` inside a pagehide handler
 * (track.ts:54, webVitals.ts:65). MEASURED in Chromium against a recording
 * sink, two independent exit fixtures (same-origin hard navigation and
 * cross-origin/cross-process navigation), both agreeing:
 *
 *   cold dynamic import, then plain fetch ....... LOST   (never arrives)
 *   WARM dynamic import, then plain fetch ....... LOST   (never arrives)
 *   plain fetch, issued synchronously ........... LANDED
 *   keepalive fetch, issued synchronously ....... LANDED
 *   navigator.sendBeacon ........................ LANDED
 *
 * The load-bearing fault is the `await`, not the chunk being cold and not the
 * missing keepalive: the warm-import leg resolves in a microtask and still
 * dies, because the document is discarded before the promise continuation
 * runs, so NO REQUEST IS EVER ISSUED. That makes the loss total for every
 * terminal batch, not probabilistic. A third fixture (Playwright page.close())
 * was discarded, not reported: it lost all five legs including the two proven
 * to land, so it had no surviving positive control and measured the harness.
 *
 * keepalive is therefore belt-and-braces here rather than the proven half —
 * the synchronous plain fetch did land against a local sink that answers
 * instantly. It is set anyway because that fixture is the friendly case, and
 * keepalive is the only documented guarantee that a request outlives its
 * document. This repo already knew that: RecruitingShortLink.tsx:31 has used
 * `keepalive: true` for exactly this reason since it was written.
 *
 * NO supabase-js IMPORT, deliberately. wave-19 (2026-06-04) pulled supabase out
 * of the eager landing graph and both writers' comments say so. The URL and the
 * publishable key are compile-time `import.meta.env` strings, so reading them
 * here adds no module edge and cannot put vendor-supabase back into cold
 * modulepreload. The insert goes straight to PostgREST.
 *
 * SAFE AS anon. public.analytics_events carries policy "Anyone can insert
 * analytics events" (cmd INSERT, WITH CHECK true, PUBLIC) — verified live
 * against pg_policy. user_id already travels in the row payload rather than
 * being derived from the JWT, so an anon-key write records the same row an
 * authenticated one would.
 */

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

/** keepalive bodies are capped at 64KB by the fetch spec; stay well under it. */
const MAX_BEACON_BYTES = 50_000;

/**
 * Issue an analytics_events insert that survives the death of this document.
 *
 * Returns true only if the request was actually handed to the network stack.
 * A false return means the caller still owns those rows and must fall back —
 * reporting "sent" on a request that was never issued is the failure mode this
 * whole module exists to end.
 *
 * MUST STAY SYNCHRONOUS. No await, no dynamic import, no promise chain before
 * the fetch call: every one of those defers the request past the point where
 * the document is torn down, which is the measured bug above.
 */
export function beaconAnalyticsRows(rows: Array<Record<string, unknown>>): boolean {
  if (rows.length === 0) return true;
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) return false;
  if (typeof fetch !== "function") return false;
  try {
    const body = JSON.stringify(rows);
    if (body.length > MAX_BEACON_BYTES) return false;
    void fetch(`${SUPABASE_URL}/rest/v1/analytics_events`, {
      method: "POST",
      keepalive: true,
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
        Prefer: "return=minimal",
      },
      body,
    }).catch(() => {}); // empty-catch-allow:telemetry-fire-and-forget
    return true;
  } catch { // empty-catch-allow:telemetry-fire-and-forget
    return false;
  }
}
