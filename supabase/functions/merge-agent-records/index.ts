import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface MergeRequest {
  primaryAgentId: string;
  duplicateAgentIds: string[];
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { primaryAgentId, duplicateAgentIds }: MergeRequest = await req.json();
    
    console.log(`🔀 Merging agents into primary ${primaryAgentId}:`, duplicateAgentIds);

    if (!primaryAgentId || !duplicateAgentIds || duplicateAgentIds.length === 0) {
      return new Response(
        JSON.stringify({ error: "Primary agent ID and duplicate IDs are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Verify primary agent exists
    const { data: primaryAgent, error: primaryError } = await supabase
      .from("agents")
      .select("id, profile_id")
      .eq("id", primaryAgentId)
      .single();

    if (primaryError || !primaryAgent) {
      return new Response(
        JSON.stringify({ error: "Primary agent not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let mergedRecords = 0;
    let archivedAgents = 0;

    // Process each duplicate
    for (const duplicateId of duplicateAgentIds) {
      // Move production records to primary
      const { data: productionRecords, error: prodSelectError } = await supabase
        .from("daily_production")
        .select("id")
        .eq("agent_id", duplicateId);

      if (!prodSelectError && productionRecords) {
        const { error: prodUpdateError } = await supabase
          .from("daily_production")
          .update({ agent_id: primaryAgentId })
          .eq("agent_id", duplicateId);

        if (prodUpdateError) {
          console.error(`Failed to move production for ${duplicateId}:`, prodUpdateError);
        } else {
          mergedRecords += productionRecords.length;
          console.log(`✅ Moved ${productionRecords.length} production records from ${duplicateId}`);
        }
      }

      // Move agent notes to primary
      const { error: notesError } = await supabase
        .from("agent_notes")
        .update({ agent_id: primaryAgentId })
        .eq("agent_id", duplicateId);

      if (notesError) {
        console.error(`Failed to move notes for ${duplicateId}:`, notesError);
      }

      // Move agent goals to primary
      const { error: goalsError } = await supabase
        .from("agent_goals")
        .update({ agent_id: primaryAgentId })
        .eq("agent_id", duplicateId);

      if (goalsError) {
        console.error(`Failed to move goals for ${duplicateId}:`, goalsError);
      }

      // Archive the duplicate agent
      const { error: archiveError } = await supabase
        .from("agents")
        .update({
          is_inactive: true,
          is_deactivated: true,
          status: "terminated",
          deactivation_reason: "bad_business", // Using existing enum value
        })
        .eq("id", duplicateId);

      if (archiveError) {
        console.error(`Failed to archive duplicate ${duplicateId}:`, archiveError);
      } else {
        archivedAgents++;
        console.log(`✅ Archived duplicate agent ${duplicateId}`);
      }
    }

    // Log the merge activity
    const { error: logError } = await supabase
      .from("activity_logs")
      .insert({
        action: "merge_agents",
        entity_type: "agent",
        entity_id: primaryAgentId,
        details: {
          merged_from: duplicateAgentIds,
          records_moved: mergedRecords,
          agents_archived: archivedAgents,
        },
      });

    if (logError) {
      console.error("Failed to log merge activity:", logError);
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Merged ${mergedRecords} records into primary agent`,
        mergedRecords,
        archivedAgents,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("Error in merge-agent-records:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
