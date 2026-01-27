import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface DealRecord {
  agent_name: string;
  annual_alp: number;
  posted_date: string; // YYYY-MM-DD format
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { deals, create_missing_agents, admin_agent_id } = await req.json();

    if (!deals || !Array.isArray(deals)) {
      return new Response(
        JSON.stringify({ error: "deals array is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`📊 Starting import of ${deals.length} deals`);

    // Get all existing agents with their profile names
    const { data: existingAgents, error: agentError } = await supabase
      .from("agents")
      .select("id, profile_id, profiles:profile_id(full_name)");

    if (agentError) {
      console.error("Error fetching agents:", agentError);
      throw agentError;
    }

    // Create a name -> agent_id mapping (case-insensitive)
    const agentNameMap: Record<string, string> = {};
    for (const agent of existingAgents || []) {
      const profiles = agent.profiles as unknown as { full_name: string } | { full_name: string }[] | null;
      const fullName = Array.isArray(profiles) ? profiles[0]?.full_name : profiles?.full_name;
      if (fullName) {
        agentNameMap[fullName.toLowerCase().trim()] = agent.id;
      }
    }

    console.log("Existing agents:", Object.keys(agentNameMap));

    // Track agents that need to be created
    const missingAgents = new Set<string>();
    const successfulDeals: DealRecord[] = [];
    const failedDeals: { deal: DealRecord; reason: string }[] = [];

    // Group deals by agent and date for aggregation
    const aggregatedProduction: Record<string, Record<string, {
      aop: number;
      deals_closed: number;
      presentations: number;
    }>> = {};

    for (const deal of deals as DealRecord[]) {
      const agentKey = deal.agent_name.toLowerCase().trim();
      const agentId = agentNameMap[agentKey];

      if (!agentId) {
        missingAgents.add(deal.agent_name);
        failedDeals.push({ deal, reason: `Agent not found: ${deal.agent_name}` });
        continue;
      }

      // Initialize nested structure if needed
      if (!aggregatedProduction[agentId]) {
        aggregatedProduction[agentId] = {};
      }
      if (!aggregatedProduction[agentId][deal.posted_date]) {
        aggregatedProduction[agentId][deal.posted_date] = {
          aop: 0,
          deals_closed: 0,
          presentations: 0,
        };
      }

      // Add to aggregated totals for this agent-date combo
      aggregatedProduction[agentId][deal.posted_date].aop += deal.annual_alp;
      aggregatedProduction[agentId][deal.posted_date].deals_closed += 1;
      // Assume each deal is 1 presentation
      aggregatedProduction[agentId][deal.posted_date].presentations += 1;

      successfulDeals.push(deal);
    }

    console.log(`📈 Aggregated production for ${Object.keys(aggregatedProduction).length} agents`);
    console.log("Missing agents:", Array.from(missingAgents));

    // Upsert aggregated production records
    const upsertResults = [];
    for (const [agentId, dates] of Object.entries(aggregatedProduction)) {
      for (const [date, stats] of Object.entries(dates)) {
        // Check if record exists
        const { data: existing } = await supabase
          .from("daily_production")
          .select("id, aop, deals_closed, presentations")
          .eq("agent_id", agentId)
          .eq("production_date", date)
          .single();

        if (existing) {
          // Update existing record by adding to existing values
          const { error: updateError } = await supabase
            .from("daily_production")
            .update({
              aop: Number(existing.aop) + stats.aop,
              deals_closed: existing.deals_closed + stats.deals_closed,
              presentations: existing.presentations + stats.presentations,
            })
            .eq("id", existing.id);

          if (updateError) {
            console.error(`Error updating ${date} for ${agentId}:`, updateError);
            upsertResults.push({ agentId, date, success: false, error: updateError.message });
          } else {
            upsertResults.push({ agentId, date, success: true, action: "updated" });
          }
        } else {
          // Insert new record
          const { error: insertError } = await supabase
            .from("daily_production")
            .insert({
              agent_id: agentId,
              production_date: date,
              aop: stats.aop,
              deals_closed: stats.deals_closed,
              presentations: stats.presentations,
            });

          if (insertError) {
            console.error(`Error inserting ${date} for ${agentId}:`, insertError);
            upsertResults.push({ agentId, date, success: false, error: insertError.message });
          } else {
            upsertResults.push({ agentId, date, success: true, action: "inserted" });
          }
        }
      }
    }

    const successCount = upsertResults.filter(r => r.success).length;
    const failCount = upsertResults.filter(r => !r.success).length;

    console.log(`✅ Import complete: ${successCount} records processed, ${failCount} failures`);

    return new Response(
      JSON.stringify({
        success: true,
        summary: {
          total_deals: deals.length,
          successful_deals: successfulDeals.length,
          failed_deals: failedDeals.length,
          production_records_created: successCount,
          production_records_failed: failCount,
          missing_agents: Array.from(missingAgents),
        },
        failed_details: failedDeals,
        upsert_results: upsertResults,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Import error:", error);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
