/**
 * agentlink-cookie-sync — pulls book-of-business from Agent Link using the
 * user's active session cookie (not an API token).
 *
 * Rationale: the /api/v1/book-of-business endpoint returns upstream HTTP 500
 * for API-token auth (documented in docs/agent-link-mapping.md). The SPA
 * itself calls the same endpoint successfully with session-cookie auth, so
 * we proxy those fetches through an edge function using a cookie the user
 * pastes in from their browser's DevTools.
 *
 * Body: { cookie: string, agent_id?: string, dry_run?: boolean }
 *
 * Returns: { ok, policies_seen, deals_inserted, deals_updated, errors[] }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BASE = "https://agentlink.insuracloud.ai";

async function fetchWithCookie(path: string, cookie: string): Promise<{ ok: boolean; status: number; body: unknown; text: string }> {
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      "Cookie": cookie,
      "Accept": "application/json",
      "User-Agent": "Mozilla/5.0 (compatible; APEX-sync/1.0)",
      "X-Requested-With": "XMLHttpRequest",
    },
  });
  const text = await res.text();
  let body: unknown = null;
  try { body = JSON.parse(text); } catch { body = null; }
  return { ok: res.ok, status: res.status, body, text };
}

function num(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  try {
    const body = await req.json().catch(() => ({})) as {
      cookie?: string; agent_id?: string; dry_run?: boolean;
    };
    const cookie = (body.cookie || "").trim();
    if (!cookie || cookie.length < 20) {
      return new Response(JSON.stringify({
        error: "Missing or invalid cookie",
        hint:  "Open agentlink.insuracloud.ai in your browser while logged in → DevTools → Application → Cookies → copy the whole cookie header",
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const dryRun = !!body.dry_run;

    // Validate cookie by hitting a small endpoint first
    const me = await fetchWithCookie("/api/v1/me", cookie);
    if (me.status === 401 || me.status === 403) {
      return new Response(JSON.stringify({
        error: "Cookie rejected by Agent Link (expired or invalid)",
        upstream_status: me.status,
        hint:  "Re-copy the cookie from your logged-in Agent Link tab and try again",
      }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Pull book-of-business
    const book = await fetchWithCookie("/api/v1/book-of-business", cookie);
    if (!book.ok) {
      return new Response(JSON.stringify({
        error: "Agent Link book-of-business error",
        upstream_status: book.status,
        upstream_body: book.text.slice(0, 400),
      }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const payload: any = book.body;
    const policies: any[] = Array.isArray(payload)            ? payload
                          : Array.isArray(payload?.policies) ? payload.policies
                          : Array.isArray(payload?.data)     ? payload.data
                          : Array.isArray(payload?.deals)    ? payload.deals
                          : [];

    if (policies.length === 0) {
      return new Response(JSON.stringify({
        ok: true,
        policies_seen: 0,
        note: "Agent Link returned empty book — nothing to import",
        me: me.body,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Resolve the agent_id for THIS sync. Hard rule (Sam, 2026-04-27):
    // we NEVER fall back to the cookie-owner's id. The cookie owner is
    // Sam (agency owner) — every policy he can SEE in book-of-business
    // belongs to a downline rep, not to him. If the caller doesn't pass
    // an explicit agent_id, we refuse to import (returning the policy
    // list so the caller can route policy-by-policy).
    const agent_id = body.agent_id || null;
    if (!agent_id) {
      return new Response(JSON.stringify({
        error: "agent_id required — sync refuses to default to cookie owner",
        hint:  "Pass body.agent_id explicitly. Each policy in this book belongs to a specific downline rep, not the cookie holder.",
        policies_seen: policies.length,
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    // Sam's agent_id is hard-blocked too — defensive belt-and-braces.
    const SAM_AGENT_ID = "7c3c5581-3544-437f-bfe2-91391afb217d";
    if (agent_id === SAM_AGENT_ID) {
      return new Response(JSON.stringify({
        error: "Refusing to attribute deals to the agency owner (Sam). He doesn't write policies; downline does.",
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Build carrier lookup
    const { data: carriers } = await sb.from("carriers").select("id, name, insuracloud_carrier_id");
    const carrierByExt  = new Map<number, string>();
    const carrierByName = new Map<string, string>();
    for (const c of (carriers ?? []) as any[]) {
      if (c.insuracloud_carrier_id) carrierByExt.set(c.insuracloud_carrier_id, c.id);
      if (c.name) carrierByName.set(c.name.toLowerCase().trim(), c.id);
    }

    const summary = {
      ok: true,
      policies_seen: policies.length,
      deals_inserted: 0,
      deals_skipped:  0,
      errors: [] as string[],
      dry_run: dryRun,
      me: me.body,
    };

    if (dryRun) return new Response(JSON.stringify(summary), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    for (const p of policies) {
      const external = String(p.id ?? p.policy_number ?? "");
      if (!external) { summary.deals_skipped++; continue; }
      const carrier_id = (p.carrier_id && carrierByExt.get(Number(p.carrier_id)))
                      || (p.carrier_name && carrierByName.get(String(p.carrier_name).toLowerCase().trim()))
                      || null;
      const row = {
        agent_id,
        carrier_id,
        client_first_name:       p.client_first_name ?? null,
        client_last_name:        p.client_last_name  ?? null,
        client_phone:            p.client_phone      ?? "UNKNOWN",
        client_dob:              p.client_dob        ?? "1970-01-01",
        product_sold:            p.product_sold ?? p.product ?? null,
        policy_number:           p.policy_number ?? external,
        monthly_premium:         num(p.monthly_premium),
        annual_premium:          num(p.annual_premium) || num(p.monthly_premium) * 12,
        face_amount:             num(p.face_amount),
        effective_date:          p.effective_date ?? new Date().toISOString().slice(0, 10),
        policy_expiration_date:  p.policy_expiration_date ?? null,
        status:                  p.status         ?? "submitted",
        pipeline_stage:          p.pipeline_stage ?? "submitted",
        source:                  "agent_link_cookie",
        external_deal_id:        external,
      };

      // Dedup by (agent_id, policy_number) — external_deal_id rotates on
      // every Agent Link re-pull which was creating 5-11 copies of the
      // same policy. Skip if a row already exists for this agent +
      // policy_number; otherwise insert.
      const policyKey = (row.policy_number || external).toString().trim();
      if (policyKey) {
        const { data: existing } = await sb
          .from("deals")
          .select("id")
          .eq("agent_id", row.agent_id)
          .eq("policy_number", policyKey)
          .limit(1)
          .maybeSingle();
        if (existing) { summary.deals_skipped++; continue; }
      }
      const { error } = await sb.from("deals").insert(row);
      if (error) summary.errors.push(`${external}: ${error.message}`);
      else       summary.deals_inserted++;
    }

    // Snapshot for audit
    if (agent_id) {
      await sb.from("insuracloud_snapshots").insert({
        agent_id,
        snapshot_date: new Date().toISOString().slice(0, 10),
        snapshot_time: new Date().toISOString(),
        source: "book-of-business (cookie-auth)",
        raw_payload: payload,
      }).catch(() => {});
    }

    return new Response(JSON.stringify(summary), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
