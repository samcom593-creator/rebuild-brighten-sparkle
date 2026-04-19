// InsuraCloud sync edge function
// Pulls /business-analytics, /book-of-business, /team-analytics
// Persists snapshots, policies, payouts, downline, and sync log
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id, idempotency-key",
};

const INSURACLOUD_BASE = "https://agentlink.insuracloud.ai/api/v1";

interface SyncRequest {
  agent_id?: string;
  full?: boolean;
}

async function fetchInsuraCloud(path: string, token: string) {
  const res = await fetch(`${INSURACLOUD_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
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

const num = (v: any): number => {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const todayISO = () => new Date().toISOString().slice(0, 10);

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
    const records: Record<string, number> = {};

    try {
      // 1) /business-analytics → snapshot
      const ba = await fetchInsuraCloud("/business-analytics", token);
      endpointsHit.push("/business-analytics");
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

      // 2) /book-of-business → policies
      const bob = await fetchInsuraCloud("/book-of-business", token);
      endpointsHit.push("/book-of-business");
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

      // 3) /team-analytics → downline + payouts
      const ta = await fetchInsuraCloud("/team-analytics", token);
      endpointsHit.push("/team-analytics");

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

      if (logId) {
        await supabase
          .from("insuracloud_sync_log")
          .update({
            status: "success",
            sync_completed_at: new Date().toISOString(),
            endpoints_hit: endpointsHit,
            records_synced: records,
          })
          .eq("id", logId);
      }
      results.push({ agent_id: a.id, ok: true, records });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[insuracloud-sync] ${a.id ?? "AGGREGATE"} failed:`, msg);
      if (logId) {
        await supabase
          .from("insuracloud_sync_log")
          .update({
            status: "error",
            sync_completed_at: new Date().toISOString(),
            error_message: msg,
            endpoints_hit: endpointsHit,
            records_synced: records,
          })
          .eq("id", logId);
      }
      results.push({ agent_id: a.id, ok: false, error: msg });
    }
  }

  return new Response(
    JSON.stringify({ ok: true, duration_ms: Date.now() - startedAt, results }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
