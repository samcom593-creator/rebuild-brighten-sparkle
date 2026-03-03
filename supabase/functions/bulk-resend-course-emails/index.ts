import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Get all agents with training course enabled and not deactivated
    const { data: agents, error } = await supabase
      .from("agents")
      .select("id")
      .eq("has_training_course", true)
      .eq("is_deactivated", false);

    if (error) throw error;
    if (!agents?.length) {
      return new Response(
        JSON.stringify({ success: true, sent: 0, message: "No agents to resend to" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get count of active modules
    const { data: activeModules, error: modError } = await supabase
      .from("onboarding_modules")
      .select("id")
      .eq("is_active", true);

    if (modError) throw modError;
    const totalActiveModules = activeModules?.length || 0;

    // Get agents who have passed ALL active modules
    const { data: progressData, error: progError } = await supabase
      .from("onboarding_progress")
      .select("agent_id, module_id, passed")
      .eq("passed", true);

    if (progError) throw progError;

    // Build set of agent IDs who passed all active modules
    const activeModuleIds = new Set((activeModules || []).map((m: any) => m.id));
    const agentPassedCounts: Record<string, number> = {};
    for (const p of (progressData || [])) {
      if (activeModuleIds.has(p.module_id)) {
        agentPassedCounts[p.agent_id] = (agentPassedCounts[p.agent_id] || 0) + 1;
      }
    }
    const completedAgentIds = new Set(
      Object.entries(agentPassedCounts)
        .filter(([_, count]) => count >= totalActiveModules)
        .map(([agentId]) => agentId)
    );

    // Filter out completed agents
    const eligibleAgents = agents.filter((a: any) => !completedAgentIds.has(a.id));

    console.log(`Total agents with course: ${agents.length}, completed: ${completedAgentIds.size}, eligible: ${eligibleAgents.length}`);

    if (!eligibleAgents.length) {
      return new Response(
        JSON.stringify({ success: true, sent: 0, message: "All agents have completed the course" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const results: { agentId: string; success: boolean; error?: string }[] = [];

    for (const agent of eligibleAgents) {
      // Rate limit: wait 600ms between sends (under 2/sec)
      await new Promise(resolve => setTimeout(resolve, 600));

      try {
        const resp = await fetch(`${supabaseUrl}/functions/v1/send-course-enrollment-email`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${serviceRoleKey}`,
          },
          body: JSON.stringify({ agentId: agent.id }),
        });

        const data = await resp.json();
        if (resp.ok && data.success) {
          results.push({ agentId: agent.id, success: true });
          console.log(`✅ Sent to agent ${agent.id}`);
        } else {
          results.push({ agentId: agent.id, success: false, error: data.error || data.message });
          console.log(`⚠️ Failed for agent ${agent.id}: ${data.error || data.message}`);
        }
      } catch (e: any) {
        results.push({ agentId: agent.id, success: false, error: e.message });
        console.error(`❌ Error for agent ${agent.id}: ${e.message}`);
      }
    }

    const sent = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    console.log(`Done: ${sent} sent, ${failed} failed out of ${eligibleAgents.length}`);

    return new Response(
      JSON.stringify({ success: true, total: eligibleAgents.length, sent, failed, skippedCompleted: completedAgentIds.size, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Error in bulk-resend-course-emails:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
