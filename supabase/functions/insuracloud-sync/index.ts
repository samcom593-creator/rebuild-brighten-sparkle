/**
 * insuracloud-sync — DEPRECATED, REDIRECT-ONLY.
 *
 * History (2026-04-27 incident): this function used the wrong upstream
 * base URL ("agentlink.replit.app") and wrong endpoint paths (no
 * /api/v1/ prefix), so every call returned the SPA's index.html and
 * parsed as $0. It was wired to a 5-minute cron and an aggregate
 * fallback path that pulled the agency-owner's downline book under
 * userId=211 (Sam) — the root cause of the 700-phantom-deals incident.
 *
 * The cron has been unscheduled (apex-pull-deals, apex-insuracloud-sync)
 * and the only sanctioned ingestion paths are:
 *   • agentlink-import       (per-agent token, /api/v1/book-of-business)
 *   • public.agentlink_live_pull()  (Cookie auth, /api/deals)
 *   • public.agentlink_upsert_from_payload()  (called by agentlink-sync.sh)
 *
 * This stub remains so that any straggling callers receive a clear,
 * loud failure rather than silently writing $0 snapshots. It does NOT
 * read or write any deal/snapshot data.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id, idempotency-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  return new Response(
    JSON.stringify({
      ok: false,
      deprecated: true,
      error:
        "insuracloud-sync is permanently disabled (caused 700-phantom-deals incident on 2026-04-27). " +
        "Use agentlink-import (per-agent token) or public.agentlink_live_pull() (Cookie auth) instead.",
    }),
    { status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
