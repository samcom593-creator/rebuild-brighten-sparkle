// InsuraCloud sync edge function
// Fetches book-of-business, business-analytics, and team-analytics
// Persists snapshots, policies, payouts, and downline data
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id, idempotency-key",
};

const INSURACLOUD_BASE = "https://agentlink.insuracloud.ai/api/v1";

interface SyncRequest {
  agent_id?: string; // when provided, sync only this agent (uses their token if set)
  full?: boolean; // full refresh vs incremental
}

async function fetchInsuraCloud(path: string, token: string) {
  const res = await fetch(`${INSURACLOUD_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`InsuraCloud ${path} ${res.status}: ${text.slice(0, 500)}`);
  }
  return data;
}

function num(v: any): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const startedAt = Date.now();
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } }
  );

  const defaultToken = Deno.env.get("INSURACLOUD_API_TOKEN");

  let body: SyncRequest = {};
  try {
    body = await req.json();
  } catch {}

  // Determine which agents to sync
  let agents: { id: string; insuracloud_api_token: string | null }[] = [];
  if (body.agent_id) {
    const { data } = await supabase
      .from("agents")
      .select("id, insuracloud_api_token")
      .eq("id", body.agent_id)
      .maybeSingle();
    if (data) agents = [data];
  } else {
    // Sync all agents that have a token, OR a single aggregate using the default token
    const { data } = await supabase
      .from("agents")
      .select("id, insuracloud_api_token")
      .not("insuracloud_api_token", "is", null);
    agents = data ?? [];
  }

  // If no per-agent tokens, do an aggregate sync using the default token
  const useAggregate = agents.length === 0 && !!defaultToken;
  if (useAggregate) {
    agents = [{ id: "AGENCY_AGGREGATE", insuracloud_api_token: defaultToken! }];
  }

  if (agents.length === 0) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "No InsuraCloud token configured (neither agent-level nor INSURACLOUD_API_TOKEN secret).",
      }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const today = todayISO();
  const results: any[] = [];

  for (const a of agents) {
    const token = a.insuracloud_api_token || defaultToken;
    if (!token) continue;

    const logRow = {
      agent_id: a.id === "AGENCY_AGGREGATE" ? null : a.id,
      sync_type: useAggregate ? "aggregate" : (body.full ? "full" : "incremental"),
      status: "running" as string,
      started_at: new Date().toISOString(),
      finished_at: null as string | null,
      error_message: null as string | null,
      records_synced: 0,
    };
    const { data: logIns } = await supabase
      .from("insuracloud_sync_log")
      .insert(logRow)
      .select("id")
      .single();
    const logId = logIns?.id;

    let synced = 0;
    try {
      // 1) Business analytics → snapshot
      const ba = await fetchInsuraCloud("/business-analytics", token);
      const snap = {
        agent_id: a.id === "AGENCY_AGGREGATE" ? null : a.id,
        snapshot_date: today,
        mtd_earnings: num(ba?.mtd_earnings ?? ba?.month_to_date?.earnings),
        ytd_earnings: num(ba?.ytd_earnings ?? ba?.year_to_date?.earnings),
        mtd_premium: num(ba?.mtd_premium ?? ba?.month_to_date?.premium),
        ytd_premium: num(ba?.ytd_premium ?? ba?.year_to_date?.premium),
        direct_commissions: num(ba?.direct_commissions),
        override_commissions: num(ba?.override_commissions),
        pending_payouts: num(ba?.pending_payouts),
        policies_active: Math.round(num(ba?.policies_active)),
        policies_pending: Math.round(num(ba?.policies_pending)),
        raw_payload: ba ?? {},
      };
      await supabase
        .from("insuracloud_snapshots")
        .upsert(snap, { onConflict: "agent_id,snapshot_date" });
      synced++;

      // 2) Book of business → policies
      const bob = await fetchInsuraCloud("/book-of-business", token);
      const policies = Array.isArray(bob) ? bob : (bob?.policies ?? bob?.data ?? []);
      if (Array.isArray(policies) && policies.length) {
        const rows = policies.slice(0, 1000).map((p: any) => ({
          agent_id: a.id === "AGENCY_AGGREGATE" ? null : a.id,
          policy_number: String(p.policy_number ?? p.id ?? p.policyId ?? crypto.randomUUID()),
          carrier: p.carrier ?? p.carrier_name ?? null,
          product: p.product ?? p.product_name ?? null,
          client_name: p.client_name ?? p.insured_name ?? null,
          premium: num(p.premium ?? p.annual_premium),
          commission: num(p.commission),
          status: p.status ?? null,
          issued_date: p.issued_date ?? p.effective_date ?? null,
          raw_payload: p,
        }));
        await supabase
          .from("insuracloud_policies")
          .upsert(rows, { onConflict: "policy_number" });
        synced += rows.length;
      }

      // 3) Team analytics → downline + payouts
      const ta = await fetchInsuraCloud("/team-analytics", token);
      const downline = ta?.downline ?? ta?.team ?? ta?.agents ?? [];
      if (Array.isArray(downline) && downline.length) {
        const rows = downline.slice(0, 100).map((d: any) => ({
          parent_agent_id: a.id === "AGENCY_AGGREGATE" ? null : a.id,
          downline_name: d.name ?? d.agent_name ?? "Unknown",
          downline_email: d.email ?? null,
          mtd_premium: num(d.mtd_premium),
          mtd_earnings: num(d.mtd_earnings),
          policies_count: Math.round(num(d.policies_count ?? d.policies)),
          snapshot_date: today,
          raw_payload: d,
        }));
        await supabase
          .from("insuracloud_downline")
          .upsert(rows, { onConflict: "parent_agent_id,downline_name,snapshot_date" });
        synced += rows.length;
      }

      const payouts = ta?.payouts ?? ba?.payouts ?? [];
      if (Array.isArray(payouts) && payouts.length) {
        const rows = payouts.slice(0, 200).map((p: any) => ({
          agent_id: a.id === "AGENCY_AGGREGATE" ? null : a.id,
          expected_date: p.date ?? p.expected_date ?? today,
          amount: num(p.amount),
          carrier: p.carrier ?? null,
          status: p.status ?? "scheduled",
          raw_payload: p,
        }));
        await supabase
          .from("insuracloud_payouts")
          .upsert(rows, { onConflict: "agent_id,expected_date,carrier" });
        synced += rows.length;
      }

      if (logId) {
        await supabase
          .from("insuracloud_sync_log")
          .update({
            status: "success",
            finished_at: new Date().toISOString(),
            records_synced: synced,
          })
          .eq("id", logId);
      }
      results.push({ agent_id: a.id, ok: true, synced });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[insuracloud-sync] ${a.id} failed:`, msg);
      if (logId) {
        await supabase
          .from("insuracloud_sync_log")
          .update({
            status: "error",
            finished_at: new Date().toISOString(),
            error_message: msg,
            records_synced: synced,
          })
          .eq("id", logId);
      }
      results.push({ agent_id: a.id, ok: false, error: msg });
    }
  }

  return new Response(
    JSON.stringify({
      ok: true,
      duration_ms: Date.now() - startedAt,
      results,
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
