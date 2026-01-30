import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    
    console.log(`[Monthly Reset] Processing reset for ${monthKey}`);

    // Get all active agents
    const { data: agents, error: agentsError } = await supabase
      .from("agents")
      .select("id")
      .eq("is_deactivated", false)
      .eq("status", "active");

    if (agentsError) {
      console.error("Error fetching agents:", agentsError);
      throw agentsError;
    }

    if (!agents?.length) {
      console.log("[Monthly Reset] No active agents found");
      return new Response(
        JSON.stringify({ success: true, message: "No active agents", month: monthKey }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Default monthly income goal (can be customized per agent)
    const defaultIncomeGoal = 10000; // $10K monthly default
    const defaultCompPercentage = 75;

    // Create or update goals for all agents for the new month
    const goalsToUpsert = agents.map(agent => ({
      agent_id: agent.id,
      month_year: monthKey,
      income_goal: defaultIncomeGoal,
      comp_percentage: defaultCompPercentage,
      updated_at: now.toISOString(),
    }));

    // Upsert goals in batches
    const batchSize = 50;
    let created = 0;
    let updated = 0;

    for (let i = 0; i < goalsToUpsert.length; i += batchSize) {
      const batch = goalsToUpsert.slice(i, i + batchSize);
      
      const { data, error } = await supabase
        .from("agent_goals")
        .upsert(batch, {
          onConflict: "agent_id,month_year",
          ignoreDuplicates: false,
        })
        .select();

      if (error) {
        console.error(`Error upserting batch ${i / batchSize + 1}:`, error);
        // Continue with other batches
      } else {
        created += data?.length || 0;
      }
    }

    // Log activity
    await supabase.from("activity_logs").insert({
      action: "monthly_goals_reset",
      entity_type: "system",
      details: {
        month: monthKey,
        agents_processed: agents.length,
        goals_created: created,
        default_income_goal: defaultIncomeGoal,
      },
    });

    console.log(`[Monthly Reset] Complete: ${created} goals set for ${monthKey}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        month: monthKey,
        agents_processed: agents.length,
        goals_created: created,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("Error in reset-monthly-goals:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
