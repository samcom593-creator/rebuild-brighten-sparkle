// InsuraCloud sync edge function
// Pulls /business-analytics, /book-of-business, /team-analytics
// Persists snapshots, policies, payouts, downline, and sync log
//
// AUTH: requires Bearer token matching APEX_BOT_TOKEN env, the persistent
// fallback (BOT_SQL_PERSISTENT_TOKEN), or system_settings.apex_bot_token.
// Same resolution policy as bot-sql so a single token rotation cycle covers
// every Claude-driven endpoint. Anonymous callers get 401.
//
// PARTIAL SUCCESS: returns ok=false when ALL agents failed, ok=true when
// all succeeded, and partial_success=true when some succeeded and some
// failed. Caller (the cron workflow + dashboards) can distinguish a hard
// outage from a single misconfigured agent.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id, idempotency-key",
};

// Default base URL flipped 2026-05-19 from agentlink.replit.app (Replit
// deployment frontend that always serves HTML) to the real REST API at
// agentlink.insuracloud.ai/api/v1. The token harvester confirmed the live
// endpoints require x-api-key header (not Bearer) and answer 200/500 not
// 200/HTML. See [[project_apex_2026_05_18_insuracloud_auth_dead]].
const INSURACLOUD_BASE =
  Deno.env.get("INSURACLOUD_BASE_URL") || "https://agentlink.insuracloud.ai/api/v1";

const PERSISTENT_TOKEN = Deno.env.get("BOT_SQL_PERSISTENT_TOKEN")?.trim() ?? "";

interface SyncRequest {
  agent_id?: string;
  full?: boolean;
}

// Custom error class so the calling handler can distinguish auth failure
// (HTML masquerade / 401) from real HTTP 5xx — and write
// status='auth_failed' to sync_log instead of fake-success.
class InsuraCloudAuthError extends Error {
  constructor(public detail: string, public sample: string) {
    super(`InsuraCloud auth failed: ${detail}`);
    this.name = "InsuraCloudAuthError";
  }
}

async function fetchInsuraCloud(path: string, token: string) {
  // x-api-key is the auth header the production InsuraCloud API actually
  // checks (confirmed via the token harvester 2026-05-19). Keep Authorization
  // as a belt-and-suspenders fallback for any legacy endpoints.
  const res = await fetch(`${INSURACLOUD_BASE}${path}`, {
    headers: {
      "x-api-key": token,
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
  const text = await res.text();
  const sample = (text ?? "").slice(0, 200);

  // ─── Reject masquerade: HTML login page returned with HTTP 200 ──────────
  // Pre-fix, the sync silently cached the login page as data — 478+ rows of
  // fake `status='success'` over 18 days. See memory entry
  // [[project-apex-2026-05-18-insuracloud-auth-dead]]. Now: any non-JSON
  // content-type, any HTML-shaped body, or any 401 → throw InsuraCloudAuthError
  // so the caller writes status='auth_failed' to sync_log instead.
  const looksLikeHtml =
    /^\s*</.test(sample) ||
    /<!DOCTYPE\s+html/i.test(sample) ||
    /<html[\s>]/i.test(sample) ||
    /Insuracloud\s*[-—]?\s*Agent\s*Link/i.test(sample);

  if (res.status === 401 || res.status === 403) {
    throw new InsuraCloudAuthError(`http_${res.status}`, sample);
  }
  if (looksLikeHtml || (contentType && !contentType.includes("application/json"))) {
    throw new InsuraCloudAuthError(
      looksLikeHtml ? "html_login_page" : `non_json_content_type:${contentType || "unknown"}`,
      sample
    );
  }

  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // Body looked like text/something — and isn't JSON. Treat as auth-fail.
    throw new InsuraCloudAuthError("unparseable_body", sample);
  }
  if (!res.ok) {
    throw new Error(`InsuraCloud ${path} ${res.status}: ${sample}`);
  }
  return data;
}

const num = (v: any): number => {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const todayISO = () => new Date().toISOString().slice(0, 10);

async function resolveValidTokens(sb: ReturnType<typeof createClient>): Promise<string[]> {
  const tokens: string[] = [];
  if (PERSISTENT_TOKEN.length > 16) tokens.push(PERSISTENT_TOKEN);
  const env = Deno.env.get("APEX_BOT_TOKEN");
  if (env && env.length > 16) tokens.push(env);
  const { data } = await sb.from("system_settings").select("value").eq("key", "apex_bot_token").maybeSingle();
  const v = (data as { value?: string } | null)?.value;
  if (v && v.length > 16) tokens.push(v);
  return tokens;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const startedAt = Date.now();
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } }
  );

  // ─── Auth ──
  // Accept EITHER a bot token (cron, server-to-server) OR a valid Supabase
  // user session JWT (in-app callers via supabase.functions.invoke). The
  // function used to be wide open with verify_jwt=false — now we gate on
  // identity explicitly so unauthenticated callers can't trigger upstream
  // pulls.
  const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization") ?? "";
  const presented = authHeader.replace(/^Bearer\s+/i, "").trim();
  const validTokens = await resolveValidTokens(supabase);
  let authedAs: "bot" | "user" | null = null;
  if (presented && validTokens.includes(presented)) {
    authedAs = "bot";
  } else if (presented) {
    const { data: userData } = await supabase.auth.getUser(presented);
    if (userData?.user) authedAs = "user";
  }
  if (!authedAs) {
    return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const defaultToken = Deno.env.get("INSURACLOUD_API_TOKEN");

  let body: SyncRequest = {};
  try {
    body = await req.json();
  } catch {}

  // Pick agents to sync
  let agents: { id: string | null; insuracloud_api_token: string | null }[] = [];
  if (body.agent_id) {
    const { data } = await supabase
      .from("agents")
      .select("id, insuracloud_api_token")
      .eq("id", body.agent_id)
      .maybeSingle();
    if (data) agents = [data];
  } else {
    const { data } = await supabase
      .from("agents")
      .select("id, insuracloud_api_token")
      .not("insuracloud_api_token", "is", null);
    agents = data ?? [];
  }

  // Fallback to a single agency-wide aggregate sync using the default token
  const useAggregate = agents.length === 0 && !!defaultToken;
  if (useAggregate) agents = [{ id: null, insuracloud_api_token: defaultToken! }];

  if (agents.length === 0) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "No InsuraCloud token configured (per-agent or INSURACLOUD_API_TOKEN secret).",
      }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const today = todayISO();
  const results: any[] = [];

  for (const a of agents) {
    const token = a.insuracloud_api_token || defaultToken;
    if (!token) continue;

    const { data: logIns } = await supabase
      .from("insuracloud_sync_log")
      .insert({
        agent_id: a.id,
        status: "running",
        endpoints_hit: [],
        records_synced: {},
      })
      .select("id")
      .single();
    const logId = logIns?.id;
    const endpointsHit: string[] = [];
    const endpointErrors: Record<string, string> = {};
    const records: Record<string, number> = {};
    let anyEndpointSucceeded = false;

    // /business-analytics → snapshot
    try {
      const ba = await fetchInsuraCloud("/business-analytics", token);
      endpointsHit.push("/business-analytics");
      anyEndpointSucceeded = true;
      const snap = {
        agent_id: a.id,
        snapshot_date: today,
        today_earnings: num(ba?.today_earnings ?? ba?.today?.earnings),
        forecast_90_day: num(ba?.forecast_90_day ?? ba?.forecast?.ninety_day),
        mtd_earnings: num(ba?.mtd_earnings ?? ba?.month_to_date?.earnings),
        ytd_earnings: num(ba?.ytd_earnings ?? ba?.year_to_date?.earnings),
        direct_commissions: num(ba?.direct_commissions),
        override_commissions: num(ba?.override_commissions),
        source: "insuracloud_api",
        raw_payload: ba ?? {},
      };
      await supabase
        .from("insuracloud_snapshots")
        .upsert(snap, { onConflict: "agent_id,snapshot_date" });
      records.snapshot = 1;
      // /team-analytics may include payouts; preserve raw ba payload for that branch
      (a as any)._ba = ba;
    } catch (err) {
      endpointErrors["/business-analytics"] = err instanceof Error ? err.message : String(err);
    }

    // /book-of-business → policies
    try {
      const bob = await fetchInsuraCloud("/book-of-business", token);
      endpointsHit.push("/book-of-business");
      anyEndpointSucceeded = true;
      const policies = Array.isArray(bob) ? bob : (bob?.policies ?? bob?.data ?? []);
      if (Array.isArray(policies) && policies.length && a.id) {
        const rows = policies.slice(0, 1000).map((p: any) => ({
          agent_id: a.id,
          policy_number: String(p.policy_number ?? p.id ?? p.policyId ?? crypto.randomUUID()),
          carrier: p.carrier ?? p.carrier_name ?? null,
          product: p.product ?? p.product_name ?? null,
          policy_type: p.policy_type ?? p.type ?? null,
          premium: num(p.premium ?? p.annual_premium),
          commission: num(p.commission),
          commission_type: p.commission_type ?? null,
          policy_status: p.status ?? p.policy_status ?? null,
          effective_date: p.effective_date ?? null,
          issued_date: p.issued_date ?? null,
          downline_agent_name: p.downline_agent_name ?? p.writing_agent ?? null,
          raw_payload: p,
        }));
        await supabase
          .from("insuracloud_policies")
          .upsert(rows, { onConflict: "agent_id,policy_number" });
        records.policies = rows.length;
      }
    } catch (err) {
      endpointErrors["/book-of-business"] = err instanceof Error ? err.message : String(err);
    }

    // /team-analytics → downline + payouts
    try {
      const ta = await fetchInsuraCloud("/team-analytics", token);
      endpointsHit.push("/team-analytics");
      anyEndpointSucceeded = true;

      const downline = ta?.downline ?? ta?.team ?? ta?.agents ?? [];
      if (Array.isArray(downline) && downline.length && a.id) {
        const rows = downline.slice(0, 100).map((d: any, i: number) => ({
          agent_id: a.id,
          downline_name: d.name ?? d.agent_name ?? "Unknown",
          downline_external_id: d.id ? String(d.id) : null,
          total_commission: num(d.total_commission ?? d.commission ?? d.mtd_earnings),
          policy_count: Math.round(num(d.policy_count ?? d.policies_count ?? d.policies)),
          rank: d.rank ?? i + 1,
          period_start: d.period_start ?? today.slice(0, 8) + "01",
          period_end: d.period_end ?? today,
          raw_payload: d,
        }));
        await supabase
          .from("insuracloud_downline")
          .upsert(rows, { onConflict: "agent_id,downline_name,period_start" });
        records.downline = rows.length;
      }

      const ba = (a as any)._ba ?? {};
      const payouts = ta?.payouts ?? ba?.payouts ?? [];
      if (Array.isArray(payouts) && payouts.length && a.id) {
        const rows = payouts.slice(0, 200).map((p: any) => ({
          agent_id: a.id,
          payout_date: p.date ?? p.payout_date ?? p.expected_date ?? today,
          amount: num(p.amount),
          policy_count: Math.round(num(p.policy_count)),
          is_today: (p.date ?? p.payout_date ?? "") === today,
          raw_payload: p,
        }));
        await supabase
          .from("insuracloud_payouts")
          .upsert(rows, { onConflict: "agent_id,payout_date" });
        records.payouts = rows.length;
      }
    } catch (err) {
      endpointErrors["/team-analytics"] = err instanceof Error ? err.message : String(err);
    }

    const agentOk = anyEndpointSucceeded && Object.keys(endpointErrors).length === 0;
    const agentPartial = anyEndpointSucceeded && Object.keys(endpointErrors).length > 0;
    // If EVERY endpoint failed with InsuraCloudAuthError (or a stringified
    // version of it), the issue is auth, not endpoint health — write a
    // dedicated 'auth_failed' status so monitoring views can distinguish it.
    const errorVals = Object.values(endpointErrors);
    const allAuthFailed =
      errorVals.length > 0 &&
      errorVals.every((e) => /auth failed|InsuraCloudAuthError|html_login_page|http_40[13]/i.test(e));
    const finalStatus = agentOk
      ? "success"
      : agentPartial
        ? "partial"
        : allAuthFailed
          ? "auth_failed"
          : "error";
    const errorSummary = Object.keys(endpointErrors).length
      ? Object.entries(endpointErrors).map(([k, v]) => `${k}: ${v}`).join(" | ")
      : null;

    if (logId) {
      await supabase
        .from("insuracloud_sync_log")
        .update({
          status: finalStatus,
          sync_completed_at: new Date().toISOString(),
          endpoints_hit: endpointsHit,
          records_synced: records,
          error_message: errorSummary,
        })
        .eq("id", logId);
    }

    if (agentOk) {
      results.push({ agent_id: a.id, ok: true, records, endpoints: endpointsHit });
    } else if (agentPartial) {
      results.push({
        agent_id: a.id,
        ok: false,
        partial: true,
        records,
        endpoints: endpointsHit,
        endpoint_errors: endpointErrors,
      });
    } else {
      console.error(`[insuracloud-sync] ${a.id ?? "AGGREGATE"} all endpoints failed:`, errorSummary);
      results.push({ agent_id: a.id, ok: false, endpoint_errors: endpointErrors });
    }
  }

  const successCount = results.filter((r) => r.ok).length;
  const partialCount = results.filter((r) => r.partial).length;
  const failCount = results.length - successCount - partialCount;
  const overallOk = successCount > 0 && failCount === 0 && partialCount === 0;
  const overallPartial = successCount > 0 && (failCount > 0 || partialCount > 0);
  const httpStatus = overallOk ? 200 : overallPartial ? 207 : 502;

  return new Response(
    JSON.stringify({
      ok: overallOk,
      partial_success: overallPartial,
      duration_ms: Date.now() - startedAt,
      counts: { success: successCount, partial: partialCount, fail: failCount },
      results,
    }),
    { status: httpStatus, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
