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
    console.log("🔥 Starting streak milestones check...");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get today's date in CST
    const now = new Date();
    const cstOffset = -6 * 60;
    const cstDate = new Date(now.getTime() + (cstOffset - now.getTimezoneOffset()) * 60000);
    const todayStr = cstDate.toISOString().split("T")[0];

    console.log(`📅 Checking streaks as of: ${todayStr}`);

    // Define streak tiers (check highest first)
    const streakTiers = [
      { type: "unstoppable", threshold: 20, badge: "UNSTOPPABLE" },
      { type: "on_fire", threshold: 10, badge: "ON FIRE" },
      { type: "hot_streak", threshold: 5, badge: "HOT STREAK" },
    ];

    // Fetch all active agents
    const { data: agents, error: agentsError } = await supabase
      .from("agents")
      .select("id")
      .eq("is_deactivated", false)
      .is("is_inactive", false);

    if (agentsError) {
      console.error("Error fetching agents:", agentsError);
      throw agentsError;
    }

    console.log(`👥 Checking streaks for ${agents?.length || 0} active agents`);

    const results: Array<{ agentId: string; streak: number; tier: string; success: boolean; error?: string }> = [];

    for (const agent of agents || []) {
      // Fetch last 30 days of production for this agent, ordered by date DESC
      const thirtyDaysAgo = new Date(cstDate);
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split("T")[0];

      const { data: production, error: prodError } = await supabase
        .from("daily_production")
        .select("production_date, deals_closed")
        .eq("agent_id", agent.id)
        .gte("production_date", thirtyDaysAgoStr)
        .lte("production_date", todayStr)
        .order("production_date", { ascending: false });

      if (prodError || !production || production.length === 0) {
        continue;
      }

      // Count consecutive days with deals starting from today
      let consecutiveDays = 0;
      let checkDate = new Date(cstDate);

      for (let i = 0; i < 30; i++) {
        const dateStr = checkDate.toISOString().split("T")[0];
        const dayProd = production.find(p => p.production_date === dateStr);
        
        if (dayProd && dayProd.deals_closed > 0) {
          consecutiveDays++;
          checkDate.setDate(checkDate.getDate() - 1);
        } else {
          break;
        }
      }

      if (consecutiveDays === 0) continue;

      // Find the highest tier they qualify for
      const qualifiedTier = streakTiers.find(tier => consecutiveDays >= tier.threshold);
      
      if (!qualifiedTier) continue;

      // Check if they already have this tier for this streak
      // We use a different approach: check if they have this tier within the last N days
      const streakStartDate = new Date(cstDate);
      streakStartDate.setDate(streakStartDate.getDate() - consecutiveDays + 1);
      const streakStartStr = streakStartDate.toISOString().split("T")[0];

      const { data: existingAward } = await supabase
        .from("plaque_awards")
        .select("id")
        .eq("agent_id", agent.id)
        .eq("milestone_type", qualifiedTier.type)
        .gte("milestone_date", streakStartStr)
        .maybeSingle();

      if (existingAward) {
        continue; // Already awarded for this streak
      }

      try {
        console.log(`🎖️ Awarding ${qualifiedTier.badge} to agent ${agent.id}: ${consecutiveDays} day streak`);

        // Record the award
        await supabase.from("plaque_awards").insert({
          agent_id: agent.id,
          milestone_type: qualifiedTier.type,
          milestone_date: todayStr,
          amount: consecutiveDays,
        });

        // Send the plaque
        const response = await fetch(`${supabaseUrl}/functions/v1/send-plaque-recognition`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${supabaseKey}`,
          },
          body: JSON.stringify({
            agentId: agent.id,
            milestoneType: qualifiedTier.type,
            amount: consecutiveDays,
            date: todayStr,
          }),
        });

        await response.json();
        results.push({ 
          agentId: agent.id, 
          streak: consecutiveDays, 
          tier: qualifiedTier.badge, 
          success: response.ok,
        });
        console.log(`✅ ${qualifiedTier.badge} plaque sent to agent ${agent.id}`);
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : "Unknown error";
        console.error(`❌ Failed to process agent ${agent.id}:`, err);
        results.push({ 
          agentId: agent.id, 
          streak: consecutiveDays, 
          tier: qualifiedTier.badge, 
          success: false, 
          error: errorMessage,
        });
      }
    }

    console.log(`🔥 Streak check complete: ${results.length} awards`);

    return new Response(
      JSON.stringify({
        success: true,
        date: todayStr,
        results,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: unknown) {
    console.error("Error in check-streak-milestones:", error);
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
