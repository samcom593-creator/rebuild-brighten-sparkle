import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Detect inactive agents and insert them into inactive_agent_queue.
 *
 * Severity rules:
 *   - 7-13 days no production  → warning
 *   - 14-29 days no production → critical
 *   - 30+ days                 → abandoned
 *
 * Skips deactivated agents and agents already in an open queue entry.
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const now = Date.now();
    const day = 24 * 3600 * 1000;
    const thirtyDaysAgo = new Date(now - 30 * day).toISOString().split("T")[0];

    // 1. All active agents
    const { data: agents, error: agentsErr } = await supabase
      .from("agents")
      .select("id, user_id, onboarding_stage, created_at, is_deactivated")
      .eq("is_deactivated", false);

    if (agentsErr) throw agentsErr;
    if (!agents || agents.length === 0) {
      return new Response(JSON.stringify({ inserted: 0, scanned: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Recent production
    const { data: recentProd } = await supabase
      .from("daily_production")
      .select("agent_id, production_date, aop, deals_closed, presentations, hours_called")
      .gte("production_date", thirtyDaysAgo);

    const prodMap = new Map<string, { lastDate: string }>();
    for (const p of recentProd || []) {
      const hasActivity =
        (Number(p.aop) || 0) > 0 ||
        (p.deals_closed || 0) > 0 ||
        (p.presentations || 0) > 0 ||
        (Number(p.hours_called) || 0) > 0;
      if (!hasActivity) continue;
      const existing = prodMap.get(p.agent_id);
      if (!existing || p.production_date > existing.lastDate) {
        prodMap.set(p.agent_id, { lastDate: p.production_date });
      }
    }

    // 3. Existing open entries
    const { data: existingOpen } = await supabase
      .from("inactive_agent_queue")
      .select("agent_id")
      .eq("status", "open");
    const openAgentSet = new Set((existingOpen || []).map((r: any) => r.agent_id));

    // 4. Build entries
    const newEntries: any[] = [];
    let warningCount = 0,
      criticalCount = 0,
      abandonedCount = 0;

    for (const agent of agents) {
      if (openAgentSet.has(agent.id)) continue;

      const prodInfo = prodMap.get(agent.id);
      let daysInactive = 999;
      let lastProdDate: string | null = null;

      if (prodInfo) {
        lastProdDate = prodInfo.lastDate;
        daysInactive = Math.floor((now - new Date(prodInfo.lastDate).getTime()) / day);
      } else {
        daysInactive = Math.floor((now - new Date(agent.created_at).getTime()) / day);
      }

      if (daysInactive < 7) continue;

      let severity: string;
      let reason: string;

      if (daysInactive >= 30) {
        severity = "abandoned";
        abandonedCount++;
        reason = prodInfo ? "no_production_14d" : "stalled_onboarding";
      } else if (daysInactive >= 14) {
        severity = "critical";
        criticalCount++;
        reason = "no_production_14d";
      } else {
        severity = "warning";
        warningCount++;
        reason = "no_production_14d";
      }

      newEntries.push({
        agent_id: agent.id,
        detected_at: new Date().toISOString(),
        days_inactive: daysInactive,
        last_production_date: lastProdDate,
        reason,
        severity,
        status: "open",
        recovery_attempts: 0,
      });
    }

    let inserted = 0;
    if (newEntries.length > 0) {
      const { error: insertErr, count } = await supabase
        .from("inactive_agent_queue")
        .insert(newEntries, { count: "exact" });
      if (insertErr) {
        console.error("Insert error:", insertErr);
      } else {
        inserted = count || newEntries.length;
      }
    }

    return new Response(
      JSON.stringify({
        scanned: agents.length,
        inserted,
        breakdown: { warning: warningCount, critical: criticalCount, abandoned: abandonedCount },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    console.error("detect-inactive-agents error:", error);
    return new Response(JSON.stringify({ error: error.message || String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
