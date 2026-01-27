import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("🔍 Checking monthly milestones...");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get the previous month's date range
    const now = new Date();
    
    // First day of previous month
    const monthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    
    // Last day of previous month
    const monthEnd = new Date(now.getFullYear(), now.getMonth(), 0);

    const monthStartStr = monthStart.toISOString().split("T")[0];
    const monthEndStr = monthEnd.toISOString().split("T")[0];
    
    const monthName = monthStart.toLocaleDateString("en-US", { month: "long", year: "numeric" });

    console.log(`📅 Month range: ${monthStartStr} to ${monthEndStr} (${monthName})`);

    // Fetch all production for the previous month grouped by agent
    const { data: monthlyProduction, error } = await supabase
      .from("daily_production")
      .select("agent_id, aop")
      .gte("production_date", monthStartStr)
      .lte("production_date", monthEndStr);

    if (error) {
      console.error("Error fetching monthly production:", error);
      throw error;
    }

    // Aggregate by agent
    const agentTotals: Record<string, number> = {};
    monthlyProduction?.forEach((row) => {
      const agentId = row.agent_id;
      const aop = Number(row.aop) || 0;
      agentTotals[agentId] = (agentTotals[agentId] || 0) + aop;
    });

    console.log(`📊 Found ${Object.keys(agentTotals).length} agents with production for ${monthName}`);

    // Find agents who hit $25K+ this month
    const eliteAgents = Object.entries(agentTotals)
      .filter(([_, total]) => total >= 25000);

    console.log(`🏆 ${eliteAgents.length} agents qualified for Elite Producer ($25K+)`);

    // Trigger plaque recognition for each qualified agent
    const results: Array<{ agentId: string; total: number; success: boolean; result?: unknown; error?: string }> = [];
    for (const [agentId, total] of eliteAgents) {
      try {
        console.log(`👑 Triggering Elite Producer plaque for agent ${agentId}: $${total.toLocaleString()}`);
        
        const response = await fetch(`${supabaseUrl}/functions/v1/send-plaque-recognition`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${supabaseKey}`,
          },
          body: JSON.stringify({
            agentId,
            milestoneType: "monthly",
            amount: total,
            date: monthEndStr,
          }),
        });

        const result = await response.json();
        results.push({ agentId, total, success: response.ok, result });
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : "Unknown error";
        console.error(`Failed to process agent ${agentId}:`, err);
        results.push({ agentId, total, success: false, error: errorMessage });
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        month: monthName,
        monthRange: { start: monthStartStr, end: monthEndStr },
        qualifiedAgents: eliteAgents.length,
        results,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: unknown) {
    console.error("Error in check-monthly-milestones:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
