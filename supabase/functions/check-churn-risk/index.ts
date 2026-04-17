import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function logRun(
  supabase: any,
  status: "success" | "error",
  affected: number,
  duration: number,
  errorMessage?: string,
) {
  try {
    await supabase.from("automation_runs").insert({
      automation_name: "Daily Churn Check",
      ran_at: new Date().toISOString(),
      status,
      agents_affected: affected,
      duration_ms: duration,
      error_message: errorMessage ?? null,
    });
  } catch (e) {
    console.error("Failed to log automation_run:", e);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const startedAt = Date.now();
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  let alertsCreated = 0;
  let agentsScanned = 0;

  try {
    const { data: agents, error: agentsErr } = await supabase
      .from("agents")
      .select("id, display_name, created_at, is_deactivated, total_policies, total_premium")
      .eq("is_deactivated", false);

    if (agentsErr) {
      console.error("Agents query failed:", agentsErr);
      throw agentsErr;
    }

    if (!agents || agents.length === 0) {
      // Not an error — just nothing to do
      console.log("check-churn-risk: no active agents to scan");
      await logRun(supabase, "success", 0, Date.now() - startedAt);
      return new Response(JSON.stringify({ success: true, alertsCreated: 0, agentsScanned: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    agentsScanned = agents.length;
    const now = new Date();
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 86400000);

    for (const agent of agents) {
      try {
        const riskFactors: string[] = [];
        let riskScore = 0;

        const { data: recentProd } = await supabase
          .from("daily_production")
          .select("deals_closed, aop, production_date")
          .eq("agent_id", agent.id)
          .gte("production_date", fourteenDaysAgo.toISOString().split("T")[0])
          .order("production_date", { ascending: false });

        const safeProd = recentProd ?? [];
        const totalRecentDeals = safeProd.reduce((s, p) => s + (p.deals_closed || 0), 0);
        const totalRecentALP = safeProd.reduce((s, p) => s + Number(p.aop || 0), 0);

        if (totalRecentDeals === 0) {
          riskScore += 35;
          riskFactors.push("No deals closed in 14 days");
        } else if (totalRecentDeals <= 1) {
          riskScore += 20;
          riskFactors.push("Only 1 deal in 14 days");
        }

        if (totalRecentALP < 1000 && totalRecentDeals > 0) {
          riskScore += 15;
          riskFactors.push("ALP below $1,000 in 14 days");
        }

        const { data: attendance } = await supabase
          .from("agent_attendance")
          .select("status")
          .eq("agent_id", agent.id)
          .gte("attendance_date", fourteenDaysAgo.toISOString().split("T")[0]);

        const safeAttendance = attendance ?? [];
        const missedDays = safeAttendance.filter(a => a.status === "absent").length;
        if (missedDays >= 5) {
          riskScore += 25;
          riskFactors.push(`Missed ${missedDays} days in 14 days`);
        } else if (missedDays >= 3) {
          riskScore += 15;
          riskFactors.push(`Missed ${missedDays} days in 14 days`);
        }

        const agentAge = Math.floor((now.getTime() - new Date(agent.created_at).getTime()) / 86400000);
        if (agentAge > 30 && (agent.total_policies || 0) === 0) {
          riskScore += 20;
          riskFactors.push("No policies after 30+ days on platform");
        }

        riskScore = Math.min(100, riskScore);

        if (riskScore >= 40) {
          const tier = riskScore >= 80 ? "critical" : riskScore >= 60 ? "high" : "medium";

          const { data: existing } = await supabase
            .from("churn_risk_alerts")
            .select("id")
            .eq("agent_id", agent.id)
            .is("resolved_at", null)
            .limit(1);

          if (existing && existing.length > 0) {
            await supabase
              .from("churn_risk_alerts")
              .update({ risk_score: riskScore, risk_tier: tier, risk_factors: riskFactors })
              .eq("id", existing[0].id);
          } else {
            await supabase
              .from("churn_risk_alerts")
              .insert({ agent_id: agent.id, risk_score: riskScore, risk_tier: tier, risk_factors: riskFactors });
          }
          alertsCreated++;
        }
      } catch (perAgentErr) {
        console.error(`Agent ${agent.id} scan failed:`, perAgentErr);
        // Continue with next agent — don't kill the whole run
      }
    }

    await logRun(supabase, "success", alertsCreated, Date.now() - startedAt);

    return new Response(JSON.stringify({ success: true, alertsCreated, agentsScanned }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("check-churn-risk fatal:", err, err?.stack);
    await logRun(supabase, "error", alertsCreated, Date.now() - startedAt, String(err?.message ?? err));
    return new Response(JSON.stringify({ error: String(err?.message ?? err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
