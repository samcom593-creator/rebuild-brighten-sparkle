import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Get all active agents
    const { data: agents, error: agentsErr } = await supabase
      .from("agents")
      .select("id, display_name, created_at, is_deactivated, total_policies, total_premium")
      .eq("is_deactivated", false)
      .is("is_inactive", null);

    if (agentsErr) throw agentsErr;

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

    let alertsCreated = 0;

    for (const agent of agents || []) {
      const riskFactors: string[] = [];
      let riskScore = 0;

      // Check recent production (last 14 days)
      const { data: recentProd } = await supabase
        .from("daily_production")
        .select("deals_closed, aop, production_date")
        .eq("agent_id", agent.id)
        .gte("production_date", fourteenDaysAgo.toISOString().split("T")[0])
        .order("production_date", { ascending: false });

      const totalRecentDeals = (recentProd || []).reduce((s, p) => s + p.deals_closed, 0);
      const totalRecentALP = (recentProd || []).reduce((s, p) => s + Number(p.aop), 0);
      const daysWithProduction = (recentProd || []).filter(p => p.deals_closed > 0).length;

      // No production in 14 days = high risk
      if (totalRecentDeals === 0) {
        riskScore += 35;
        riskFactors.push("No deals closed in 14 days");
      } else if (totalRecentDeals <= 1) {
        riskScore += 20;
        riskFactors.push("Only 1 deal in 14 days");
      }

      // Low ALP
      if (totalRecentALP < 1000 && totalRecentDeals > 0) {
        riskScore += 15;
        riskFactors.push("ALP below $1,000 in 14 days");
      }

      // Check attendance (last 14 days)
      const { data: attendance } = await supabase
        .from("agent_attendance")
        .select("status")
        .eq("agent_id", agent.id)
        .gte("attendance_date", fourteenDaysAgo.toISOString().split("T")[0]);

      const missedDays = (attendance || []).filter(a => a.status === "absent").length;
      if (missedDays >= 5) {
        riskScore += 25;
        riskFactors.push(`Missed ${missedDays} days in 14 days`);
      } else if (missedDays >= 3) {
        riskScore += 15;
        riskFactors.push(`Missed ${missedDays} days in 14 days`);
      }

      // New agent with no production after 30+ days
      const agentAge = Math.floor((now.getTime() - new Date(agent.created_at).getTime()) / (1000 * 60 * 60 * 24));
      if (agentAge > 30 && (agent.total_policies || 0) === 0) {
        riskScore += 20;
        riskFactors.push("No policies after 30+ days on platform");
      }

      // Cap at 100
      riskScore = Math.min(100, riskScore);

      // Only create alert if risk >= 40
      if (riskScore >= 40) {
        const tier = riskScore >= 80 ? "critical" : riskScore >= 60 ? "high" : riskScore >= 40 ? "medium" : "low";

        // Check for existing unresolved alert
        const { data: existing } = await supabase
          .from("churn_risk_alerts")
          .select("id")
          .eq("agent_id", agent.id)
          .is("resolved_at", null)
          .limit(1);

        if (existing && existing.length > 0) {
          // Update existing
          await supabase
            .from("churn_risk_alerts")
            .update({ risk_score: riskScore, risk_tier: tier, risk_factors: riskFactors })
            .eq("id", existing[0].id);
        } else {
          // Create new
          await supabase
            .from("churn_risk_alerts")
            .insert({ agent_id: agent.id, risk_score: riskScore, risk_tier: tier, risk_factors: riskFactors });
        }
        alertsCreated++;
      }
    }

    return new Response(JSON.stringify({ success: true, alertsCreated, agentsScanned: (agents || []).length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
