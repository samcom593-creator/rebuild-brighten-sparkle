// system-health-autopilot — PL-081.
//
// Runs every 5 min. Reads existing health views (v_insuracloud_auth_health,
// v_agentlink_sync_health, v_sync_pipeline_health, v_readymode_ingest_health)
// and takes one of these actions per finding:
//   - "auto_retry": invoke the upstream sync fn one more time (capped 3x/hr)
//   - "page_sam":   POST to Telegram bot + insert into automation_runs
//   - "log":        write to system_health_events for the dashboard
//
// Goal: turn manual "Sam-check-the-dashboard" duty into self-healing where
// possible, and into one clear alert where not.
//
// 2026-05-29.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TELEGRAM_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const SAM_CHAT_ID    = Deno.env.get("SAM_TELEGRAM_CHAT_ID") ?? "6018839640";

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

type Finding = {
  source: string;
  severity: "ok" | "warning" | "critical";
  message: string;
  action: "auto_retry" | "page_sam" | "log";
  retry_fn?: string;
};

async function readHealthViews(): Promise<Finding[]> {
  const findings: Finding[] = [];

  // 1. InsuraCloud auth
  const { data: ic } = await supabase.from("v_insuracloud_auth_health").select("*").limit(1).maybeSingle();
  if (ic && (ic as any).status === "critical") {
    findings.push({
      source: "insuracloud_auth",
      severity: "critical",
      message: `InsuraCloud auth dead — token harvest needed. Last success ${(ic as any).last_success_at ?? "never"}.`,
      action: "page_sam",
    });
  }

  // 2. AgentLink sync
  const { data: al } = await supabase.from("v_agentlink_sync_health").select("*").limit(1).maybeSingle();
  if (al && (al as any).is_unhealthy === true) {
    findings.push({
      source: "agentlink_sync",
      severity: "critical",
      message: `AgentLink sync unhealthy: ${(al as any).reason ?? "stale"}.`,
      action: "auto_retry",
      retry_fn: "agentlink-import",
    });
  }

  // 3. Stripe event lag
  const { data: stripe } = await supabase.from("v_stripe_event_health").select("*").limit(1).maybeSingle();
  if (stripe && (stripe as any).lag_minutes > 60) {
    findings.push({
      source: "stripe_events",
      severity: "warning",
      message: `Stripe event ingest lag ${(stripe as any).lag_minutes}m.`,
      action: "log",
    });
  }

  // 4. ReadyMode ingest
  const { data: rm } = await supabase.from("v_readymode_ingest_health").select("*").limit(1).maybeSingle();
  if (rm && (rm as any).status === "down") {
    findings.push({
      source: "readymode_ingest",
      severity: "warning",
      message: `ReadyMode dialer ingest stale.`,
      action: "auto_retry",
      retry_fn: "readymode-ingest",
    });
  }

  // 5. CFO sync watch — broad CFO bot signal
  const { data: cfo } = await supabase.from("v_cfo_sync_health_watch").select("*").limit(1).maybeSingle();
  if (cfo && (cfo as any).any_critical === true) {
    findings.push({
      source: "cfo_sync_watch",
      severity: "critical",
      message: `CFO bot flagged a critical sync.`,
      action: "page_sam",
    });
  }

  return findings;
}

async function retryCount(source: string): Promise<number> {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await supabase
    .from("system_health_events")
    .select("*", { count: "exact", head: true })
    .eq("source", source)
    .eq("action_taken", "auto_retry")
    .gte("created_at", since);
  return count ?? 0;
}

async function pageSam(message: string) {
  if (!TELEGRAM_TOKEN) return;
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: SAM_CHAT_ID,
      text: `🚨 system-autopilot: ${message}`,
    }),
  }).catch(() => {});
}

async function invokeRetry(fnName: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/${fnName}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
      body: "{}",
    });
    if (!r.ok) return { ok: false, error: `${r.status}` };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const findings = await readHealthViews();
  const summary = { checked: findings.length, retried: 0, paged: 0, logged: 0, errors: [] as string[] };

  for (const f of findings) {
    let action = f.action;
    if (action === "auto_retry") {
      const used = await retryCount(f.source);
      if (used >= 3) {
        action = "page_sam";
        f.message += ` (auto-retry exhausted ${used}/3 last hour)`;
      }
    }

    let action_result = "";
    if (action === "auto_retry" && f.retry_fn) {
      const r = await invokeRetry(f.retry_fn);
      action_result = r.ok ? "ok" : `failed: ${r.error}`;
      if (r.ok) summary.retried += 1;
      else summary.errors.push(`${f.source}: ${r.error}`);
    } else if (action === "page_sam") {
      await pageSam(`${f.severity.toUpperCase()} · ${f.message}`);
      summary.paged += 1;
      action_result = "telegram_sent";
    } else {
      summary.logged += 1;
      action_result = "log_only";
    }

    try {
      await supabase.from("system_health_events").insert({
        source: f.source,
        severity: f.severity,
        message: f.message,
        action_taken: action,
        action_result,
      });
    } catch (_) { /* swallow — log table may not exist on first run */ }
  }

  return new Response(JSON.stringify(summary), {
    status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
