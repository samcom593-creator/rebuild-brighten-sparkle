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
 *
 * AUTH: requires Bearer token matching APEX_BOT_TOKEN env, the persistent
 * fallback (BOT_SQL_PERSISTENT_TOKEN), SUPABASE_SERVICE_ROLE_KEY (internal
 * server-to-server callers such as system-health-autopilot), or
 * system_settings.apex_bot_token — OR a valid Supabase user session JWT.
 * Same resolution policy as bot-sql / insuracloud-sync so one token rotation
 * cycle covers every Claude-driven endpoint. Anonymous callers get 401.
 *
 * TOTAL FAILURE: a run where EVERY agent's upstream fetch failed returns 502
 * with the error summary and writes one status='error' row to
 * agentlink_sync_log, instead of the old ok:true with a silently ignored
 * errors[] and no persistent trace.
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

const CLAUDE_PERSISTENT_TOKEN =
  Deno.env.get("BOT_SQL_PERSISTENT_TOKEN") ||
  // Same persistent fallback as bot-sql / insuracloud-sync so a single
  // rotation covers every endpoint. If you rotate, update all of them.
  "37740df6728db61e128392dbbdae34be1dccf862eebe09925ff321182fb30ebd";

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

async function resolveValidTokens(sb: any): Promise<string[]> {
  const tokens: string[] = [CLAUDE_PERSISTENT_TOKEN];
  const env = Deno.env.get("APEX_BOT_TOKEN");
  if (env && env.length > 16) tokens.push(env);
  // system-health-autopilot retries this function server-to-server with the
  // service-role key; accepting it keeps that path alive (anyone holding it
  // already has full DB access, so this widens nothing).
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (service && service.length > 16) tokens.push(service);
  const { data } = await sb.from("system_settings").select("value").eq("key", "apex_bot_token").maybeSingle();
  const v = (data as { value?: string } | null)?.value;
  if (v && v.length > 16) tokens.push(v);
  return tokens;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const startedAt = Date.now();
  const sb = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  try {
    // ─── Auth ──
    // Accept EITHER a bot token (cron, server-to-server) OR a valid Supabase
    // user session JWT (in-app callers via supabase.functions.invoke). This
    // function ships with verify_jwt=false in config.toml, so before this gate
    // any internet caller could trigger upstream pulls and writes to deals.
    const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization") ?? "";
    const presented = authHeader.replace(/^Bearer\s+/i, "").trim();
    const validTokens = await resolveValidTokens(sb);
    let authedAs: "bot" | "user" | null = null;
    if (presented && validTokens.includes(presented)) {
      authedAs = "bot";
    } else if (presented) {
      const { data: userData } = await sb.auth.getUser(presented);
      if (userData?.user) authedAs = "user";
    }
    if (!authedAs) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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
      agents_fetched:   0,
      agents_failed:    0,
    };

    for (const { agent_id, token, label } of pairs) {
      summary.agents_processed++;

      let payload: any;
      try {
        payload = await fetchJson("/api/v1/book-of-business", token);
      } catch (err) {
        summary.agents_failed++;
        summary.errors.push(`${label}: ${String(err)}`);
        continue;
      }
      // Upstream answered with parseable JSON for this agent — the pull itself
      // worked even if it carried 0 policies.
      summary.agents_fetched++;

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

      // AgentLink returns garbage placeholder external IDs ("0000","RN","123","123456","null") for some deals.
      // They collide on idx_deals_external_deal_id_unique and break the whole batch — coerce to NULL.
      const PLACEHOLDER_EXTERNAL = /^(0+|RN|123|123456|null|none|n\/a|undefined)$/i;

      for (const p of policies) {
        let externalRaw = String(p.id ?? p.policy_number ?? "");
        if (!externalRaw) continue;
        const external = PLACEHOLDER_EXTERNAL.test(externalRaw) ? null : externalRaw;
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
        if (error) {
          if (error.code === "23505") { /* dup on unique index, silent skip — already imported */ }
          else summary.errors.push(`upsert ${externalRaw}: ${error.message}`);
        } else {
          summary.deals_inserted++;
        }
      }

      // Keep the raw payload as a snapshot for audit
      // supabase-js QueryBuilder is a thenable but does NOT expose .catch — must await + try/catch
      try {
        await sb.from("insuracloud_snapshots").insert({
          agent_id,
          snapshot_date: new Date().toISOString().slice(0, 10),
          snapshot_time: new Date().toISOString(),
          source: "book-of-business",
          raw_payload: payload,
        });
      } catch (_snapshotErr) { /* snapshot is audit-only; never block the import */ }
    }

    // ─── Total wipeout is not a success ──
    // Pre-fix this returned ok:true even when EVERY agent's upstream fetch
    // threw, so a dead Agent Link looked identical to a clean run and left no
    // persistent trace anywhere. Now: one status='error' row in
    // agentlink_sync_log (the same log the pg-side AgentLink pull writes) plus
    // a 502 carrying the error summary. Partial failures keep the old 200 so
    // one misconfigured agent can't fail the whole batch.
    if (summary.agents_fetched === 0 && summary.agents_failed > 0) {
      const errorSummary = summary.errors.join(" | ").slice(0, 4000);
      if (!dryRun) {
        // supabase-js QueryBuilder is a thenable but does NOT expose .catch — must await + try/catch
        try {
          await sb.from("agentlink_sync_log").insert({
            started_at:     new Date(startedAt).toISOString(),
            finished_at:    new Date().toISOString(),
            status:         "error",
            policies_seen:  summary.policies_seen,
            deals_inserted: summary.deals_inserted,
            deals_updated:  summary.deals_updated,
            error_message:  `agentlink-import: all ${summary.agents_failed} agent fetch(es) failed — ${errorSummary}`,
          });
        } catch (_logErr) { /* never let the log write mask the real failure */ }
      }
      return new Response(
        JSON.stringify({ ok: false, error: "all_agent_fetches_failed", error_summary: errorSummary, ...summary }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
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
