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

      // ========== PRODUCTION RECORDS (with date conflict handling) ==========
      const { data: dupProduction } = await supabase
        .from("daily_production")
        .select("*")
        .eq("agent_id", duplicateId);

      if (dupProduction && dupProduction.length > 0) {
        for (const record of dupProduction) {
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
              await supabase.from("daily_production").delete().eq("id", record.id);
              mergedRecords++;
            }
          } else {
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

      // ========== SIMPLE REASSIGN TABLES ==========
      // Each of these just needs agent_id updated to primaryAgentId

      const simpleReassignTables = [
        { table: "agent_notes", column: "agent_id", label: "notes" },
        { table: "agent_goals", column: "agent_id", label: "goals" },
        { table: "agent_achievements", column: "agent_id", label: "achievements" },
        { table: "plaque_awards", column: "agent_id", label: "plaques" },
        { table: "onboarding_progress", column: "agent_id", label: "onboarding progress" },
        { table: "agent_metrics", column: "agent_id", label: "metrics" },
        { table: "agent_lead_stats", column: "agent_id", label: "lead stats" },
        { table: "agent_attendance", column: "agent_id", label: "attendance" },
        { table: "agent_ratings", column: "agent_id", label: "ratings" },
        { table: "agent_onboarding", column: "agent_id", label: "onboarding history" },
        { table: "email_tracking", column: "agent_id", label: "email tracking" },
        { table: "lead_payment_tracking", column: "agent_id", label: "lead payments" },
        { table: "invitation_seen", column: "agent_id", label: "invitation seen" },
        { table: "magic_login_tokens", column: "agent_id", label: "magic tokens" },
        { table: "agent_removal_requests", column: "agent_id", label: "removal requests" },
        { table: "interview_recordings", column: "agent_id", label: "interview recordings" },
      ];

      for (const { table, column, label } of simpleReassignTables) {
        const { error } = await supabase
          .from(table)
          .update({ [column]: primaryAgentId })
          .eq(column, duplicateId);
        if (error) console.error(`Failed to move ${label} for ${duplicateId}:`, error);
      }

      // ========== APPLICATION & LEAD REASSIGNMENT ==========
      const { error: appsError } = await supabase
        .from("applications")
        .update({ assigned_agent_id: primaryAgentId })
        .eq("assigned_agent_id", duplicateId);
      if (appsError) console.error(`Failed to reassign applications for ${duplicateId}:`, appsError);

      const { error: leadsError } = await supabase
        .from("aged_leads")
        .update({ assigned_manager_id: primaryAgentId })
        .eq("assigned_manager_id", duplicateId);
      if (leadsError) console.error(`Failed to reassign aged leads for ${duplicateId}:`, leadsError);

      // ========== CONTACT HISTORY (agent_id column) ==========
      const { error: contactError } = await supabase
        .from("contact_history")
        .update({ agent_id: primaryAgentId })
        .eq("agent_id", duplicateId);
      if (contactError) console.error(`Failed to move contact history for ${duplicateId}:`, contactError);

      // ========== CONTRACTING LINKS ==========
      const { error: contractingError } = await supabase
        .from("contracting_links")
        .update({ manager_id: primaryAgentId })
        .eq("manager_id", duplicateId);
      if (contractingError) console.error(`Failed to move contracting links for ${duplicateId}:`, contractingError);

      // ========== MANAGER INVITE LINKS ==========
      const { error: inviteLinksError } = await supabase
        .from("manager_invite_links")
        .update({ manager_agent_id: primaryAgentId })
        .eq("manager_agent_id", duplicateId);
      if (inviteLinksError) console.error(`Failed to move invite links for ${duplicateId}:`, inviteLinksError);

      // ========== AGENT HIERARCHY REFERENCES ==========
      await supabase
        .from("agents")
        .update({ manager_id: primaryAgentId })
        .eq("manager_id", duplicateId);

      await supabase
        .from("agents")
        .update({ invited_by_manager_id: primaryAgentId })
        .eq("invited_by_manager_id", duplicateId);

      await supabase
        .from("agents")
        .update({ switched_to_manager_id: primaryAgentId })
        .eq("switched_to_manager_id", duplicateId);

      // ========== DELETE DUPLICATE AGENT ==========
      const { error: deleteError } = await supabase
        .from("agents")
        .delete()
        .eq("id", duplicateId);

      if (deleteError) {
        console.error(`Failed to delete duplicate ${duplicateId}:`, deleteError);
        // Fallback: archive if delete fails (remaining foreign key constraints)
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
