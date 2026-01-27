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
    console.log("🏆 Starting comeback milestones check...");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get today's date in CST
    const now = new Date();
    const cstOffset = -6 * 60;
    const cstDate = new Date(now.getTime() + (cstOffset - now.getTimezoneOffset()) * 60000);
    const todayStr = cstDate.toISOString().split("T")[0];

    // Calculate this week (Sunday to Saturday)
    const dayOfWeek = cstDate.getDay();
    
    // This week's Saturday (end of week)
    const thisWeekEnd = new Date(cstDate);
    thisWeekEnd.setDate(cstDate.getDate() + (6 - dayOfWeek));
    
    // This week's Sunday (start of week)
    const thisWeekStart = new Date(thisWeekEnd);
    thisWeekStart.setDate(thisWeekEnd.getDate() - 6);
    
    // Last week's range
    const lastWeekEnd = new Date(thisWeekStart);
    lastWeekEnd.setDate(thisWeekStart.getDate() - 1);
    const lastWeekStart = new Date(lastWeekEnd);
    lastWeekStart.setDate(lastWeekEnd.getDate() - 6);

    const thisWeekStartStr = thisWeekStart.toISOString().split("T")[0];
    const thisWeekEndStr = thisWeekEnd.toISOString().split("T")[0];
    const lastWeekStartStr = lastWeekStart.toISOString().split("T")[0];
    const lastWeekEndStr = lastWeekEnd.toISOString().split("T")[0];

    console.log(`📅 This week: ${thisWeekStartStr} to ${thisWeekEndStr}`);
    console.log(`📅 Last week: ${lastWeekStartStr} to ${lastWeekEndStr}`);

    // Fetch this week's production
    const { data: thisWeekProd, error: thisWeekError } = await supabase
      .from("daily_production")
      .select("agent_id, aop")
      .gte("production_date", thisWeekStartStr)
      .lte("production_date", thisWeekEndStr);

    if (thisWeekError) throw thisWeekError;

    // Fetch last week's production
    const { data: lastWeekProd, error: lastWeekError } = await supabase
      .from("daily_production")
      .select("agent_id, aop")
      .gte("production_date", lastWeekStartStr)
      .lte("production_date", lastWeekEndStr);

    if (lastWeekError) throw lastWeekError;

    // Aggregate by agent
    const thisWeekTotals: Record<string, number> = {};
    const lastWeekTotals: Record<string, number> = {};

    thisWeekProd?.forEach((row) => {
      thisWeekTotals[row.agent_id] = (thisWeekTotals[row.agent_id] || 0) + (Number(row.aop) || 0);
    });

    lastWeekProd?.forEach((row) => {
      lastWeekTotals[row.agent_id] = (lastWeekTotals[row.agent_id] || 0) + (Number(row.aop) || 0);
    });

    console.log(`📊 This week totals:`, Object.keys(thisWeekTotals).length, "agents");
    console.log(`📊 Last week totals:`, Object.keys(lastWeekTotals).length, "agents");

    // Calculate improvements
    const improvements: Array<{ agentId: string; thisWeek: number; lastWeek: number; improvement: number }> = [];

    for (const [agentId, thisWeek] of Object.entries(thisWeekTotals)) {
      const lastWeek = lastWeekTotals[agentId] || 0;
      const improvement = thisWeek - lastWeek;
      
      // Only consider positive improvements of $3,000+
      if (improvement >= 3000) {
        improvements.push({ agentId, thisWeek, lastWeek, improvement });
      }
    }

    // Sort by improvement (highest first)
    improvements.sort((a, b) => b.improvement - a.improvement);

    console.log(`📈 Found ${improvements.length} agents with $3K+ improvement`);

    const results: Array<{ agentId: string; improvement: number; success: boolean; error?: string }> = [];

    // Award Comeback Champion to the top improver (or all who meet threshold)
    for (const improver of improvements) {
      // Check if already awarded this week
      const { data: existingAward } = await supabase
        .from("plaque_awards")
        .select("id")
        .eq("agent_id", improver.agentId)
        .eq("milestone_type", "comeback_champion")
        .gte("milestone_date", thisWeekStartStr)
        .maybeSingle();

      if (existingAward) {
        console.log(`⏭️ Agent ${improver.agentId} already has Comeback Champion this week`);
        continue;
      }

      try {
        console.log(`🎖️ Awarding COMEBACK CHAMPION to agent ${improver.agentId}: +$${improver.improvement.toLocaleString()}`);

        // Record the award
        await supabase.from("plaque_awards").insert({
          agent_id: improver.agentId,
          milestone_type: "comeback_champion",
          milestone_date: todayStr,
          amount: improver.improvement,
        });

        // Send the plaque
        const response = await fetch(`${supabaseUrl}/functions/v1/send-plaque-recognition`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${supabaseKey}`,
          },
          body: JSON.stringify({
            agentId: improver.agentId,
            milestoneType: "comeback_champion",
            amount: improver.improvement,
            date: todayStr,
          }),
        });

        await response.json();
        results.push({ 
          agentId: improver.agentId, 
          improvement: improver.improvement, 
          success: response.ok,
        });
        console.log(`✅ Comeback Champion plaque sent to agent ${improver.agentId}`);
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : "Unknown error";
        console.error(`❌ Failed to process agent ${improver.agentId}:`, err);
        results.push({ 
          agentId: improver.agentId, 
          improvement: improver.improvement, 
          success: false, 
          error: errorMessage,
        });
      }
    }

    console.log(`🏆 Comeback check complete: ${results.length} awards`);

    return new Response(
      JSON.stringify({
        success: true,
        date: todayStr,
        thisWeek: { start: thisWeekStartStr, end: thisWeekEndStr },
        lastWeek: { start: lastWeekStartStr, end: lastWeekEndStr },
        results,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: unknown) {
    console.error("Error in check-comeback-milestones:", error);
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
