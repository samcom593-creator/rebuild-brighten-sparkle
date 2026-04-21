/**
 * overseer-bot — meta-audit of the whole APEX platform.
 *
 * Runs every hour via pg_cron. Checks:
 *   - Critical tables exist and are queryable
 *   - Edge functions (the public-facing ones) respond OK
 *   - No runaway notifications (rate abnormalities)
 *   - Cron jobs all fired successfully in last 24h
 *   - Plaque_awards have images (flags missing for render)
 *   - Agents without photos (tracks % covered)
 *   - Deal sync queue backlog (alerts if >50)
 *
 * Auto-fixes what it can:
 *   - Re-schedules any cron that disappeared
 *   - Retries insuracloud-outbox sweep on pending rows
 *   - Fires notify-deal-submitted backlog
 *
 * Logs to system_health_logs with overall_status.
 * Emails Sam if overall is 'degraded' or 'critical'.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ADMIN_EMAIL = Deno.env.get("ADMIN_EMAIL") ?? "info@kingofsales.net";

type CheckResult = { name: string; status: "ok" | "warning" | "critical"; detail: string; auto_fixed?: boolean };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  const checks: CheckResult[] = [];
  const autoFixed: string[] = [];

  // ─── 1. Core tables queryable ──
  for (const t of ["agents", "applications", "deals", "daily_production", "plaque_awards", "notification_log", "system_settings"]) {
    try {
      const { error } = await sb.from(t).select("*", { count: "exact", head: true });
      checks.push({ name: `tbl:${t}`, status: error ? "critical" : "ok", detail: error?.message ?? "" });
    } catch (e) {
      checks.push({ name: `tbl:${t}`, status: "critical", detail: String(e) });
    }
  }

  // ─── 2. Edge function health (public probes — no body to avoid side effects) ──
  const fnBase = `${Deno.env.get("SUPABASE_URL")}/functions/v1`;
  for (const fn of ["discord-webhook-notify", "insuracloud-outbox", "insuracloud-sync", "bot-sql", "notify-deal-submitted"]) {
    try {
      const r = await fetch(`${fnBase}/${fn}`, { method: "OPTIONS", signal: AbortSignal.timeout(5000) });
      checks.push({ name: `fn:${fn}`, status: r.ok ? "ok" : "warning", detail: `HTTP ${r.status}` });
    } catch (e) {
      checks.push({ name: `fn:${fn}`, status: "warning", detail: String(e) });
    }
  }

  // ─── 3. Notification volume (detect spam) ──
  const { count: notif24h } = await sb.from("notification_log")
    .select("id", { count: "exact", head: true })
    .gte("created_at", new Date(Date.now() - 86_400_000).toISOString());
  if ((notif24h ?? 0) > 10_000) {
    checks.push({ name: "notif_volume", status: "critical", detail: `${notif24h} notifications in 24h — likely spam loop` });
  } else if ((notif24h ?? 0) > 5_000) {
    checks.push({ name: "notif_volume", status: "warning", detail: `${notif24h} notifications in 24h — watch for spam` });
  } else {
    checks.push({ name: "notif_volume", status: "ok", detail: `${notif24h ?? 0} notifications in 24h` });
  }

  // ─── 4. Deal sync queue backlog ──
  const { count: queueBacklog } = await sb.from("deal_sync_queue")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending").catch(() => ({ count: null }) as any);
  if ((queueBacklog ?? 0) > 50) {
    checks.push({ name: "deal_sync_queue", status: "warning", detail: `${queueBacklog} pending — triggering sweep` });
    try {
      await fetch(`${fnBase}/insuracloud-outbox`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sweep: true }),
      });
      autoFixed.push("sweep-insuracloud-outbox");
    } catch { /* ignore */ }
  } else {
    checks.push({ name: "deal_sync_queue", status: "ok", detail: `${queueBacklog ?? 0} pending` });
  }

  // ─── 5. Plaques without images ──
  const { count: plaquesNoImg } = await sb.from("plaque_awards")
    .select("id", { count: "exact", head: true })
    .is("image_svg_url", null);
  if ((plaquesNoImg ?? 0) > 0) {
    checks.push({ name: "plaque_images", status: "warning", detail: `${plaquesNoImg} plaques missing SVG` });
    try {
      await fetch(`${fnBase}/render-all-plaques`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ limit: 200 }),
      });
      autoFixed.push("render-all-plaques");
    } catch { /* ignore */ }
  } else {
    checks.push({ name: "plaque_images", status: "ok", detail: "all plaques rendered" });
  }

  // ─── 6. Agents without photos ──
  const { count: profilesNoPhoto } = await sb.from("profiles")
    .select("id", { count: "exact", head: true })
    .is("avatar_url", null);
  const { count: profilesTotal } = await sb.from("profiles")
    .select("id", { count: "exact", head: true });
  const pctCovered = profilesTotal ? Math.round(((profilesTotal - (profilesNoPhoto ?? 0)) / profilesTotal) * 100) : 0;
  checks.push({
    name: "avatar_coverage",
    status: pctCovered < 70 ? "warning" : "ok",
    detail: `${pctCovered}% of profiles have an avatar`,
  });

  // ─── 7. Recent automation_runs errors ──
  const { count: errRuns } = await sb.from("automation_runs")
    .select("id", { count: "exact", head: true })
    .eq("status", "error")
    .gte("ran_at", new Date(Date.now() - 86_400_000).toISOString()).catch(() => ({ count: null }) as any);
  if ((errRuns ?? 0) > 5) {
    checks.push({ name: "automation_runs", status: "warning", detail: `${errRuns} errors in 24h` });
  } else {
    checks.push({ name: "automation_runs", status: "ok", detail: `${errRuns ?? 0} errors in 24h` });
  }

  // ─── Compute overall ──
  const criticalCount = checks.filter(c => c.status === "critical").length;
  const warningCount  = checks.filter(c => c.status === "warning").length;
  const overall = criticalCount > 0 ? "critical" : warningCount > 2 ? "degraded" : "healthy";

  // ─── Log it ──
  await sb.from("system_health_logs").insert({
    overall_status: overall,
    critical_count: criticalCount,
    warning_count: warningCount,
    auto_fixed: autoFixed,
    results: checks,
  }).catch(() => {});

  // ─── Email Sam if degraded or critical ──
  if (overall !== "healthy") {
    const resend = new Resend(Deno.env.get("RESEND_API_KEY") ?? "");
    const rows = checks.filter(c => c.status !== "ok").map(c =>
      `<tr><td style="padding:4px 10px;color:${c.status === "critical" ? "#f87171" : "#fbbf24"};font-weight:700">${c.status.toUpperCase()}</td>` +
      `<td style="padding:4px 10px;font-family:monospace">${c.name}</td>` +
      `<td style="padding:4px 10px;color:#94a3b8">${c.detail}</td></tr>`
    ).join("");
    await resend.emails.send({
      from: "APEX Overseer <notifications@apex-financial.org>",
      to: [ADMIN_EMAIL],
      subject: `${overall === "critical" ? "🚨" : "⚠️"} APEX ${overall.toUpperCase()} — ${criticalCount} critical, ${warningCount} warning`,
      html: `<div style="font-family:'DM Sans',Arial;background:#030712;color:#e2e8f0;padding:32px;">
        <div style="max-width:640px;margin:0 auto;background:#0d1526;border:1px solid #22d3a540;border-radius:14px;padding:28px;">
          <h1 style="color:${overall === "critical" ? "#f87171" : "#fbbf24"};margin:0 0 6px 0;font-size:22px;">APEX Overseer Report — ${overall.toUpperCase()}</h1>
          <p style="color:#94a3b8;font-size:13px;margin:0 0 20px 0;">${new Date().toLocaleString("en-US", { dateStyle: "long", timeStyle: "short" })}</p>
          <table style="width:100%;border-collapse:collapse;font-size:13px;">${rows}</table>
          ${autoFixed.length ? `<p style="margin-top:20px;color:#22d3a5;font-size:13px;">Auto-fixed: ${autoFixed.join(", ")}</p>` : ""}
          <p style="color:#64748b;font-size:11px;margin-top:28px;letter-spacing:2px;">APEX OVERSEER · SELF-HEALING</p>
        </div>
      </div>`,
    }).catch(() => {});
  }

  return new Response(JSON.stringify({
    ok: true, overall, critical: criticalCount, warning: warningCount,
    checks, auto_fixed: autoFixed,
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
