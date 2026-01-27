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
    console.log("🔍 Checking weekly milestones...");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Calculate the week range (Sunday to Saturday)
    const now = new Date();
    const dayOfWeek = now.getDay();
    
    // Start of week (last Sunday)
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - dayOfWeek);
    weekStart.setHours(0, 0, 0, 0);
    
    // End of week (this Saturday)
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);

    const weekStartStr = weekStart.toISOString().split("T")[0];
    const weekEndStr = weekEnd.toISOString().split("T")[0];

    console.log(`📅 Week range: ${weekStartStr} to ${weekEndStr}`);

    // Fetch all production for this week grouped by agent
    const { data: weeklyProduction, error } = await supabase
      .from("daily_production")
      .select("agent_id, aop")
      .gte("production_date", weekStartStr)
      .lte("production_date", weekEndStr);

    if (error) {
      console.error("Error fetching weekly production:", error);
      throw error;
    }

    // Aggregate by agent
    const agentTotals: Record<string, number> = {};
    weeklyProduction?.forEach((row) => {
      const agentId = row.agent_id;
      const aop = Number(row.aop) || 0;
      agentTotals[agentId] = (agentTotals[agentId] || 0) + aop;
    });

    console.log(`📊 Found ${Object.keys(agentTotals).length} agents with production this week`);

    // Find agents who hit $10K+ this week
    const diamondAgents = Object.entries(agentTotals)
      .filter(([_, total]) => total >= 10000);

    console.log(`💎 ${diamondAgents.length} agents qualified for Diamond week ($10K+)`);

    // Trigger plaque recognition for each qualified agent
    const results: Array<{ agentId: string; total: number; success: boolean; result?: unknown; error?: string }> = [];
    for (const [agentId, total] of diamondAgents) {
      try {
        console.log(`🏆 Triggering Diamond plaque for agent ${agentId}: $${total.toLocaleString()}`);
        
        const response = await fetch(`${supabaseUrl}/functions/v1/send-plaque-recognition`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${supabaseKey}`,
          },
          body: JSON.stringify({
            agentId,
            milestoneType: "weekly",
            amount: total,
            date: weekEndStr,
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
        weekRange: { start: weekStartStr, end: weekEndStr },
        qualifiedAgents: diamondAgents.length,
        results,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: unknown) {
    console.error("Error in check-weekly-milestones:", error);
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
