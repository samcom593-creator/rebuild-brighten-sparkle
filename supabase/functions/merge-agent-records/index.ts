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
    // Require authentication
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Unauthorized - no auth token provided" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Create client with user's token for auth verification
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Verify the user
    const token = authHeader.replace("Bearer ", "");
    const { data: claims, error: claimsError } = await userClient.auth.getClaims(token);
    
    if (claimsError || !claims?.claims) {
      console.error("Auth verification failed:", claimsError);
      return new Response(
        JSON.stringify({ error: "Unauthorized - invalid token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userId = claims.claims.sub as string;
    console.log(`🔐 User ${userId} attempting merge`);

    // Use service role client for admin operations
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Check if user has admin role
    const { data: roles, error: rolesError } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);

    if (rolesError) {
      console.error("Error fetching roles:", rolesError);
      return new Response(
        JSON.stringify({ error: "Failed to verify permissions" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const isAdmin = roles?.some((r) => r.role === "admin");
    if (!isAdmin) {
      console.log(`❌ User ${userId} is not admin, roles:`, roles);
      return new Response(
        JSON.stringify({ error: "Forbidden - admin access required" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { primaryAgentId, duplicateAgentIds }: MergeRequest = await req.json();
    
    console.log(`🔀 Admin ${userId} merging agents into primary ${primaryAgentId}:`, duplicateAgentIds);

    if (!primaryAgentId || !duplicateAgentIds || duplicateAgentIds.length === 0) {
      return new Response(
        JSON.stringify({ error: "Primary agent ID and duplicate IDs are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Prevent self-merge
    if (duplicateAgentIds.includes(primaryAgentId)) {
      return new Response(
        JSON.stringify({ error: "Cannot merge an agent into itself" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

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
    const errors: string[] = [];

    // Process each duplicate
    for (const duplicateId of duplicateAgentIds) {
      console.log(`📦 Processing duplicate ${duplicateId}`);

      // Move production records to primary (handle date conflicts)
      const { data: dupProduction } = await supabase
        .from("daily_production")
        .select("*")
        .eq("agent_id", duplicateId);

      if (dupProduction && dupProduction.length > 0) {
        for (const record of dupProduction) {
          // Check if primary already has this date
          const { data: existingRecord } = await supabase
            .from("daily_production")
            .select("*")
            .eq("agent_id", primaryAgentId)
            .eq("production_date", record.production_date)
            .maybeSingle();

          if (existingRecord) {
            // Merge by summing values into existing record
            const { error: updateError } = await supabase
              .from("daily_production")
              .update({
                presentations: (existingRecord.presentations || 0) + (record.presentations || 0),
                deals_closed: (existingRecord.deals_closed || 0) + (record.deals_closed || 0),
                aop: Number(existingRecord.aop || 0) + Number(record.aop || 0),
                hours_called: Number(existingRecord.hours_called || 0) + Number(record.hours_called || 0),
                referrals_caught: (existingRecord.referrals_caught || 0) + (record.referrals_caught || 0),
                referral_presentations: (existingRecord.referral_presentations || 0) + (record.referral_presentations || 0),
                booked_inhome_referrals: (existingRecord.booked_inhome_referrals || 0) + (record.booked_inhome_referrals || 0),
                passed_price: (existingRecord.passed_price || 0) + (record.passed_price || 0),
              })
              .eq("id", existingRecord.id);

            if (updateError) {
              console.error(`Failed to merge production for date ${record.production_date}:`, updateError);
              errors.push(`Production merge conflict on ${record.production_date}`);
            } else {
              // Delete the duplicate record after merging
              await supabase.from("daily_production").delete().eq("id", record.id);
              mergedRecords++;
            }
          } else {
            // No conflict - just reassign to primary
            const { error: reassignError } = await supabase
              .from("daily_production")
              .update({ agent_id: primaryAgentId })
              .eq("id", record.id);

            if (reassignError) {
              console.error(`Failed to reassign production ${record.id}:`, reassignError);
            } else {
              mergedRecords++;
            }
          }
        }
        console.log(`✅ Processed ${dupProduction.length} production records from ${duplicateId}`);
      }

      // Move agent notes to primary
      const { error: notesError } = await supabase
        .from("agent_notes")
        .update({ agent_id: primaryAgentId })
        .eq("agent_id", duplicateId);
      if (notesError) console.error(`Failed to move notes for ${duplicateId}:`, notesError);

      // Move agent goals to primary
      const { error: goalsError } = await supabase
        .from("agent_goals")
        .update({ agent_id: primaryAgentId })
        .eq("agent_id", duplicateId);
      if (goalsError) console.error(`Failed to move goals for ${duplicateId}:`, goalsError);

      // Move agent achievements to primary
      const { error: achievementsError } = await supabase
        .from("agent_achievements")
        .update({ agent_id: primaryAgentId })
        .eq("agent_id", duplicateId);
      if (achievementsError) console.error(`Failed to move achievements for ${duplicateId}:`, achievementsError);

      // Move plaque awards to primary
      const { error: plaquesError } = await supabase
        .from("plaque_awards")
        .update({ agent_id: primaryAgentId })
        .eq("agent_id", duplicateId);
      if (plaquesError) console.error(`Failed to move plaques for ${duplicateId}:`, plaquesError);

      // Move onboarding progress to primary
      const { error: progressError } = await supabase
        .from("onboarding_progress")
        .update({ agent_id: primaryAgentId })
        .eq("agent_id", duplicateId);
      if (progressError) console.error(`Failed to move progress for ${duplicateId}:`, progressError);

      // Move agent metrics to primary
      const { error: metricsError } = await supabase
        .from("agent_metrics")
        .update({ agent_id: primaryAgentId })
        .eq("agent_id", duplicateId);
      if (metricsError) console.error(`Failed to move metrics for ${duplicateId}:`, metricsError);

      // Move lead stats to primary
      const { error: leadStatsError } = await supabase
        .from("agent_lead_stats")
        .update({ agent_id: primaryAgentId })
        .eq("agent_id", duplicateId);
      if (leadStatsError) console.error(`Failed to move lead stats for ${duplicateId}:`, leadStatsError);

      // Reassign applications from duplicate to primary
      const { error: appsError } = await supabase
        .from("applications")
        .update({ assigned_agent_id: primaryAgentId })
        .eq("assigned_agent_id", duplicateId);
      if (appsError) console.error(`Failed to reassign applications for ${duplicateId}:`, appsError);

      // Reassign aged leads from duplicate to primary
      const { error: leadsError } = await supabase
        .from("aged_leads")
        .update({ assigned_manager_id: primaryAgentId })
        .eq("assigned_manager_id", duplicateId);
      if (leadsError) console.error(`Failed to reassign aged leads for ${duplicateId}:`, leadsError);

      // Update agents that had this duplicate as manager
      await supabase
        .from("agents")
        .update({ manager_id: primaryAgentId })
        .eq("manager_id", duplicateId);

      await supabase
        .from("agents")
        .update({ invited_by_manager_id: primaryAgentId })
        .eq("invited_by_manager_id", duplicateId);

      // DELETE the duplicate agent completely
      const { error: deleteError } = await supabase
        .from("agents")
        .delete()
        .eq("id", duplicateId);

      if (deleteError) {
        console.error(`Failed to delete duplicate ${duplicateId}:`, deleteError);
        // Fallback: archive if delete fails (e.g., remaining foreign key constraints)
        const { error: archiveError } = await supabase
          .from("agents")
          .update({
            is_inactive: true,
            is_deactivated: true,
            status: "terminated",
            deactivation_reason: "bad_business",
          })
          .eq("id", duplicateId);
        
        if (!archiveError) {
          archivedAgents++;
          console.log(`✅ Archived duplicate agent ${duplicateId} (delete failed)`);
        } else {
          errors.push(`Failed to delete/archive ${duplicateId}`);
        }
      } else {
        archivedAgents++;
        console.log(`✅ Deleted duplicate agent ${duplicateId}`);
      }
    }

    // Log the merge activity
    const { error: logError } = await supabase
      .from("activity_logs")
      .insert({
        action: "merge_agents",
        entity_type: "agent",
        entity_id: primaryAgentId,
        user_id: userId,
        details: {
          merged_from: duplicateAgentIds,
          records_moved: mergedRecords,
          agents_archived: archivedAgents,
          errors: errors.length > 0 ? errors : undefined,
        },
      });

    if (logError) {
      console.error("Failed to log merge activity:", logError);
    }

    const message = errors.length > 0
      ? `Merged ${mergedRecords} records with ${errors.length} warnings`
      : `Merged ${mergedRecords} records into primary agent`;

    return new Response(
      JSON.stringify({
        success: true,
        message,
        mergedRecords,
        archivedAgents,
        errors: errors.length > 0 ? errors : undefined,
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
