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
    console.log("🏆 Starting nightly daily plaque check...");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get today's date in CST (UTC-6)
    const now = new Date();
    const cstOffset = -6 * 60; // CST is UTC-6
    const cstDate = new Date(now.getTime() + (cstOffset - now.getTimezoneOffset()) * 60000);
    const todayStr = cstDate.toISOString().split("T")[0];

    console.log(`📅 Checking production for date: ${todayStr}`);

    // Fetch all production for today
    const { data: dailyProduction, error } = await supabase
      .from("daily_production")
      .select("agent_id, aop")
      .eq("production_date", todayStr);

    if (error) {
      console.error("Error fetching daily production:", error);
      throw error;
    }

    console.log(`📊 Found ${dailyProduction?.length || 0} production records for today`);

    // Define plaque tiers (check highest first)
    const tiers = [
      { type: "single_day_platinum", threshold: 5000, badge: "PLATINUM" },
      { type: "single_day", threshold: 3000, badge: "GOLD" },
      { type: "single_day_bronze", threshold: 1000, badge: "BRONZE" },
    ];

    const results: Array<{ agentId: string; amount: number; tier: string; success: boolean; error?: string }> = [];

    for (const record of dailyProduction || []) {
      const aop = Number(record.aop) || 0;
      
      // Find the highest tier this agent qualifies for
      const qualifiedTier = tiers.find(tier => aop >= tier.threshold);
      
      if (!qualifiedTier) {
        continue; // Doesn't meet minimum threshold
      }

      // Check if plaque already awarded today for this type
      const { data: existingAward } = await supabase
        .from("plaque_awards")
        .select("id")
        .eq("agent_id", record.agent_id)
        .eq("milestone_type", qualifiedTier.type)
        .eq("milestone_date", todayStr)
        .maybeSingle();

      if (existingAward) {
        console.log(`⏭️ Agent ${record.agent_id} already has ${qualifiedTier.badge} for ${todayStr}`);
        continue;
      }

      try {
        console.log(`🎖️ Awarding ${qualifiedTier.badge} plaque to agent ${record.agent_id}: $${aop.toLocaleString()}`);

        // Record the award first
        await supabase.from("plaque_awards").insert({
          agent_id: record.agent_id,
          milestone_type: qualifiedTier.type,
          milestone_date: todayStr,
          amount: aop,
        });

        // Send the plaque recognition email
        const response = await fetch(`${supabaseUrl}/functions/v1/send-plaque-recognition`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${supabaseKey}`,
          },
          body: JSON.stringify({
            agentId: record.agent_id,
            milestoneType: qualifiedTier.type,
            amount: aop,
            date: todayStr,
          }),
        });

        // Also notify manager of downline production
        try {
          await fetch(`${supabaseUrl}/functions/v1/notify-manager-downline-production`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${supabaseKey}`,
            },
            body: JSON.stringify({
              agentId: record.agent_id,
              amount: aop,
              date: todayStr,
            }),
          });
          console.log(`📧 Manager notification triggered for ${record.agent_id}`);
        } catch (notifyErr) {
          console.error("Manager notify failed:", notifyErr);
        }

        const result = await response.json();
        results.push({ 
          agentId: record.agent_id, 
          amount: aop, 
          tier: qualifiedTier.badge, 
          success: response.ok,
        });
        
        console.log(`✅ ${qualifiedTier.badge} plaque sent for agent ${record.agent_id}`);
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : "Unknown error";
        console.error(`❌ Failed to process agent ${record.agent_id}:`, err);
        results.push({ 
          agentId: record.agent_id, 
          amount: aop, 
          tier: qualifiedTier.badge, 
          success: false, 
          error: errorMessage,
        });
      }
    }

    const summary = {
      platinum: results.filter(r => r.tier === "PLATINUM" && r.success).length,
      gold: results.filter(r => r.tier === "GOLD" && r.success).length,
      bronze: results.filter(r => r.tier === "BRONZE" && r.success).length,
    };

    // Also run team milestone check
    try {
      await fetch(`${supabaseUrl}/functions/v1/check-team-milestones`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify({}),
      });
      console.log("✅ Team milestone check triggered");
    } catch (teamErr) {
      console.error("Team milestone check failed:", teamErr);
    }

    console.log(`🏆 Daily plaque check complete:`, summary);

    return new Response(
      JSON.stringify({
        success: true,
        date: todayStr,
        summary,
        results,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: unknown) {
    console.error("Error in check-daily-plaques:", error);
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
