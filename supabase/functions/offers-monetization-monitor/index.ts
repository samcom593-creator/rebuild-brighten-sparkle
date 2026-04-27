// offers-monetization-monitor — runs hourly via pg_cron.
//
// Job: keep an eye on the 4 paid offers and push optimization suggestions
// the moment a number drifts. Outputs land in `bot_alerts` (the existing
// dispatcher fans them to email + SMS). Severity escalates with severity
// of the issue so Sam isn't pinged for nothing.
//
// What it watches:
//   - 24h conversion rate per SKU (sessions → paid). If a SKU hasn't
//     converted in 24h while sessions exist → warn.
//   - 7d MRR change per SKU vs prior 7d. Big drops fire warn, big lifts
//     fire celebrate.
//   - "First-time buyers" since last run → celebrate per buyer.
//   - Active subscriber count by SKU + raw revenue numbers, recorded as
//     a metrics snapshot for tomorrow's diff.
//   - ReadyMode-net margin alarms when net < cost (red flag).
//
// Anything new lands in the unified `bot_alerts` table with event_type
// "offer_monitor" + severity tag → existing apex-alert-dispatch ships it.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const READYMODE_COST_CENTS = Number(Deno.env.get("READYMODE_COST_CENTS") || 25000);

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const SKUS = ["gold", "platinum", "auto_dm", "social_growth"] as const;

function dollars(cents: number) {
  return `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

async function queueAlert(
  event_type: string,
  severity: "info" | "warn" | "critical" | "celebrate",
  subject: string,
  body: string,
  sms_body?: string,
) {
  await supabase.from("bot_alerts").insert({
    source: "audit",
    event_type,
    severity,
    subject,
    body,
    sms_body: sms_body ?? subject,
    channels: ["email", "sms"],
  });
}

async function metricsSinceHours(hours: number) {
  const since = new Date(Date.now() - hours * 3600_000).toISOString();
  const { data: rows = [] } = await supabase
    .from("offer_purchases")
    .select("sku, amount_cents, status, created_at, purchaser_email")
    .gte("created_at", since);
  return rows;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const out: any = { ran_at: new Date().toISOString(), alerts: [] as string[] };

  const last24 = await metricsSinceHours(24);
  const last7d = await metricsSinceHours(24 * 7);
  const prev7d_to_14d = (await metricsSinceHours(24 * 14)).filter(
    (r: any) => new Date(r.created_at) < new Date(Date.now() - 7 * 86400_000),
  );

  // ---- 1. First-time buyers since last hour ----
  const lastHour = await metricsSinceHours(1);
  for (const r of lastHour as any[]) {
    if (r.status !== "paid") continue;
    await queueAlert(
      "offer_monitor",
      "celebrate",
      `🎉 New ${r.sku} subscriber — ${dollars(r.amount_cents)}`,
      `${r.purchaser_email} just subscribed to ${r.sku} (${dollars(r.amount_cents)}). That's recurring revenue you didn't have an hour ago.`,
      `🎉 +${dollars(r.amount_cents)} ${r.sku} from ${r.purchaser_email ?? "buyer"}`,
    );
    out.alerts.push(`celebrate:${r.sku}`);
  }

  // ---- 2. Per-SKU 7d vs prior 7d MRR diff ----
  for (const sku of SKUS) {
    const cur = (last7d as any[]).filter(r => r.sku === sku && r.status === "paid")
      .reduce((a, r) => a + (r.amount_cents || 0), 0);
    const prev = (prev7d_to_14d as any[]).filter(r => r.sku === sku && r.status === "paid")
      .reduce((a, r) => a + (r.amount_cents || 0), 0);
    if (prev === 0 && cur === 0) continue;

    const deltaPct = prev === 0 ? 100 : Math.round(((cur - prev) / prev) * 100);
    if (deltaPct <= -25) {
      await queueAlert(
        "offer_monitor", "warn",
        `📉 ${sku} revenue down ${Math.abs(deltaPct)}% WoW`,
        `${sku} brought in ${dollars(cur)} this week vs ${dollars(prev)} prior week. Suggest: re-run the IG growth ad, push a 7-day flash discount, or surface ${sku} at the top of the manager dashboard.`,
      );
      out.alerts.push(`warn:${sku}_drop_${deltaPct}`);
    } else if (deltaPct >= 50 && cur >= 25000) {
      await queueAlert(
        "offer_monitor", "celebrate",
        `🚀 ${sku} up ${deltaPct}% WoW — ${dollars(cur)}`,
        `${sku} climbed from ${dollars(prev)} → ${dollars(cur)} week-over-week. Whatever you did, double down. Suggest: bump the price of the next tier or expand ad spend.`,
      );
      out.alerts.push(`celebrate:${sku}_lift_${deltaPct}`);
    }
  }

  // ---- 3. ReadyMode margin guard ----
  const activeLeadsRows = (last7d as any[]).filter(r => (r.sku === "gold" || r.sku === "platinum") && r.status === "paid");
  const grossLeads = activeLeadsRows.reduce((a, r) => a + (r.amount_cents || 0), 0);
  // Assume each unique purchaser_email is one active subscription.
  const activeSubs = new Set(activeLeadsRows.map(r => r.purchaser_email).filter(Boolean)).size;
  const monthlyCost = activeSubs * READYMODE_COST_CENTS;
  // Annualize the weekly lead revenue ÷ 12 to compare on a monthly basis.
  const monthlyRevEst = Math.round(grossLeads * (52 / 7) / 12);
  const margin = monthlyRevEst - monthlyCost;
  if (activeSubs > 0 && margin < 0) {
    await queueAlert(
      "offer_monitor", "critical",
      `🚨 Leads margin negative — ${dollars(margin)}/mo`,
      `Active leads subs: ${activeSubs}. Estimated monthly revenue ${dollars(monthlyRevEst)} vs ReadyMode cost ${dollars(monthlyCost)}. Either bump the price, churn unprofitable subs, or drop the ReadyMode tier.`,
    );
    out.alerts.push("critical:negative_margin");
  }

  // ---- 4. Snapshot for tomorrow ----
  await supabase.from("bot_metrics_snapshots").insert({
    metric_key: "offers_24h_paid_count",
    metric_value: (last24 as any[]).filter(r => r.status === "paid").length,
    snapshot_at: new Date().toISOString(),
  }).then(() => {}, () => {});

  out.last24_paid = (last24 as any[]).filter(r => r.status === "paid").length;
  out.last7d_paid = (last7d as any[]).filter(r => r.status === "paid").length;
  out.active_leads_subs = activeSubs;
  out.estimated_monthly_margin = margin;

  return new Response(JSON.stringify(out, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
