/**
 * agentlink-import — pulls real book-of-business from Agent Link
 *
 * Uses the CORRECT /api/v1/book-of-business endpoint (the existing
 * insuracloud-sync function was hitting /business-analytics which falls
 * through to the SPA index.html, returning HTML instead of JSON).
 *
 * For every policy returned, upserts a row into public.deals with
 * source='agent_link' and external_deal_id = policy id from upstream.
 * Also stores the full raw payload in insuracloud_snapshots for audit.
 *
 * Body: { agent_id?: string, dry_run?: boolean }
 *   - agent_id omitted → import for every agent with an insuracloud token
 *     (including the shared default INSURACLOUD_API_TOKEN env var)
 *   - dry_run: true → return what would be imported without writing
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BASE = Deno.env.get("INSURACLOUD_BASE_URL") || "https://agentlink.insuracloud.ai";
const DEFAULT_TOKEN = Deno.env.get("INSURACLOUD_API_TOKEN") || "";

type Policy = {
  id?: string | number;
  policy_number?: string;
  client_first_name?: string;
  client_last_name?: string;
  client_phone?: string;
  client_dob?: string;
  product?: string;
  product_sold?: string;
  carrier_name?: string;
  carrier_id?: number;
  monthly_premium?: number | string;
  annual_premium?: number | string;
  face_amount?: number | string;
  effective_date?: string;
  policy_expiration_date?: string;
  status?: string;
  pipeline_stage?: string;
};

async function fetchJson(path: string, token: string): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      "Authorization": `Bearer ${token}`,
      "x-api-key": token,
      "Accept": "application/json",
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${path} → ${res.status}: ${text.slice(0, 200)}`);
  }
  try { return JSON.parse(text); }
  catch { throw new Error(`${path} returned non-JSON (got HTML — wrong endpoint): ${text.slice(0, 80)}`); }
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
    const body = await req.json().catch(() => ({}));
    const dryRun = !!body.dry_run;
    const specificAgent = body.agent_id as string | undefined;

    // Build the list of (agent_id, token) pairs to pull
    const { data: agents } = await sb
      .from("agents")
      .select("id, insuracloud_api_token, profile:profiles(full_name)")
      .eq("is_deactivated", false)
      .eq("is_inactive", false);

    // Hard rule (Sam, 2026-04-27): each agent must use THEIR OWN
    // insuracloud_api_token. We never silently fall back to the agency
    // master token (DEFAULT_TOKEN) — that path was returning Sam's
    // entire downline book and stamping every policy with whatever
    // agent_id we were looping on (causing 100+ duplicate deals on Sam
    // and false attributions across the team).
    const SAM_AGENT_ID = "7c3c5581-3544-437f-bfe2-91391afb217d";
    const pairs: Array<{ agent_id: string; token: string; label: string }> = [];
    for (const a of (agents ?? []) as any[]) {
      if (specificAgent && a.id !== specificAgent) continue;
      if (a.id === SAM_AGENT_ID) continue; // never auto-import to agency owner
      const t = a.insuracloud_api_token;
      if (!t || t.length < 10) continue; // no fallback — skip without own token
      pairs.push({ agent_id: a.id, token: t, label: a.profile?.full_name ?? "Agent" });
    }

    if (pairs.length === 0) {
      return new Response(
        JSON.stringify({ error: "No agents with InsuraCloud token configured" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Resolve carrier id → supabase carrier uuid, prefer insuracloud_carrier_id match then name
    const { data: carriers } = await sb
      .from("carriers")
      .select("id, name, insuracloud_carrier_id");
    const carrierByExt  = new Map<number, string>();
    const carrierByName = new Map<string, string>();
    for (const c of (carriers ?? []) as any[]) {
      if (c.insuracloud_carrier_id) carrierByExt.set(c.insuracloud_carrier_id, c.id);
      if (c.name) carrierByName.set(c.name.toLowerCase().trim(), c.id);
    }

    const summary = {
      agents_processed: 0,
      policies_seen:    0,
      deals_inserted:   0,
      deals_updated:    0,
      errors:           [] as string[],
      dry_run:          dryRun,
    };

    for (const { agent_id, token, label } of pairs) {
      summary.agents_processed++;

      let payload: any;
      try {
        payload = await fetchJson("/api/v1/book-of-business", token);
      } catch (err) {
        summary.errors.push(`${label}: ${String(err)}`);
        continue;
      }

      const policies: Policy[] = Array.isArray(payload)            ? payload
                               : Array.isArray(payload?.policies) ? payload.policies
                               : Array.isArray(payload?.data)     ? payload.data
                               : Array.isArray(payload?.deals)    ? payload.deals
                               : [];

      if (policies.length === 0) {
        summary.errors.push(`${label}: 0 policies returned`);
        continue;
      }

      summary.policies_seen += policies.length;
      if (dryRun) continue;

      for (const p of policies) {
        const external = String(p.id ?? p.policy_number ?? "");
        if (!external) continue;
        const carrier_id = (p.carrier_id && carrierByExt.get(Number(p.carrier_id)))
          || (p.carrier_name && carrierByName.get(String(p.carrier_name).toLowerCase().trim()))
          || null;
        const row = {
          agent_id,
          carrier_id,
          client_first_name:  p.client_first_name ?? null,
          client_last_name:   p.client_last_name  ?? null,
          client_phone:       p.client_phone      ?? null,
          client_dob:         p.client_dob        ?? null,
          product_sold:       p.product_sold ?? p.product ?? null,
          policy_number:      p.policy_number ?? external,
          monthly_premium:    num(p.monthly_premium),
          annual_premium:     num(p.annual_premium) || num(p.monthly_premium) * 12,
          face_amount:        num(p.face_amount),
          effective_date:     p.effective_date ?? null,
          policy_expiration_date: p.policy_expiration_date ?? null,
          status:             p.status ?? "submitted",
          pipeline_stage:     p.pipeline_stage ?? "submitted",
          source:             "agent_link",
          external_deal_id:   external,
        };

        // Dedup by (agent_id, policy_number) — external_deal_id rotates on
        // every Agent Link re-pull and was creating duplicate copies of
        // the same policy.
        const policyKey = String(row.policy_number || external).trim();
        if (policyKey) {
          const { data: existing } = await sb
            .from("deals")
            .select("id")
            .eq("agent_id", row.agent_id)
            .eq("policy_number", policyKey)
            .limit(1)
            .maybeSingle();
          if (existing) { continue; } // already imported, skip
        }
        const { error } = await sb.from("deals").insert(row);
        if (error) summary.errors.push(`upsert ${external}: ${error.message}`);
        else       summary.deals_inserted++;
      }

      // Keep the raw payload as a snapshot for audit
      await sb.from("insuracloud_snapshots").insert({
        agent_id,
        snapshot_date: new Date().toISOString().slice(0, 10),
        snapshot_time: new Date().toISOString(),
        source: "book-of-business",
        raw_payload: payload,
      }).catch(() => {});
    }

    return new Response(JSON.stringify({ ok: true, ...summary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
