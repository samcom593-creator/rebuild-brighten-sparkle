import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.2";
import { Resend } from "npm:resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

interface AgentSummary {
  name: string;
  email: string;
  stage: string;
  licenseStatus: string;
  weeklyProduction: number;
  monthlyProduction: number;
  courseProgress: number;
  needsAttention: boolean;
  attentionReason?: string;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    console.log("Starting weekly team summary...");

    // Get all admin users
    const { data: adminRoles } = await supabaseAdmin
      .from("user_roles")
      .select("user_id")
      .eq("role", "admin");

    if (!adminRoles?.length) {
      console.log("No admins found");
      return new Response(JSON.stringify({ message: "No admins found" }), {
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // Get admin profiles
    const adminUserIds = adminRoles.map((r) => r.user_id);
    const { data: adminProfiles } = await supabaseAdmin
      .from("profiles")
      .select("email, full_name")
      .in("user_id", adminUserIds);

    // Get all active agents with their data
    const { data: agents } = await supabaseAdmin
      .from("agents")
      .select(`
        id,
        user_id,
        onboarding_stage,
        license_status,
        is_deactivated,
        created_at
      `)
      .eq("is_deactivated", false);

    if (!agents?.length) {
      console.log("No agents found");
      return new Response(JSON.stringify({ message: "No agents found" }), {
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const agentIds = agents.map((a) => a.id);
    const userIds = agents.map((a) => a.user_id).filter(Boolean);

    // Get profiles
    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("user_id, full_name, email")
      .in("user_id", userIds);

    // Get production data for this week and month
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay());
    weekStart.setHours(0, 0, 0, 0);
    const weekStartStr = weekStart.toISOString().split("T")[0];

    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthStartStr = monthStart.toISOString().split("T")[0];

    const { data: production } = await supabaseAdmin
      .from("daily_production")
      .select("agent_id, production_date, aop")
      .in("agent_id", agentIds)
      .gte("production_date", monthStartStr);

    // Get course progress
    const { data: progress } = await supabaseAdmin
      .from("onboarding_progress")
      .select("agent_id, passed")
      .in("agent_id", agentIds);

    const { data: modules } = await supabaseAdmin
      .from("onboarding_modules")
      .select("id")
      .eq("is_active", true);

    const totalModules = modules?.length || 1;

    // Build agent summaries
    const summaries: AgentSummary[] = agents.map((agent) => {
      const profile = profiles?.find((p) => p.user_id === agent.user_id);
      const agentProduction = production?.filter((p) => p.agent_id === agent.id) || [];
      const agentProgress = progress?.filter((p) => p.agent_id === agent.id) || [];

      const weeklyProd = agentProduction
        .filter((p) => p.production_date >= weekStartStr)
        .reduce((sum, p) => sum + (Number(p.aop) || 0), 0);

      const monthlyProd = agentProduction.reduce((sum, p) => sum + (Number(p.aop) || 0), 0);

      const passedModules = agentProgress.filter((p) => p.passed).length;
      const courseProgress = Math.round((passedModules / totalModules) * 100);

      // Determine if needs attention
      let needsAttention = false;
      let attentionReason = "";

      if (agent.license_status === "unlicensed" && agent.onboarding_stage !== "onboarding") {
        needsAttention = true;
        attentionReason = "Unlicensed but past onboarding stage";
      } else if (courseProgress < 100 && agent.onboarding_stage === "in_field_training") {
        needsAttention = true;
        attentionReason = "In field but course not complete";
      } else if (monthlyProd === 0 && agent.onboarding_stage === "evaluated") {
        needsAttention = true;
        attentionReason = "Evaluated but no production this month";
      }

      return {
        name: profile?.full_name || "Unknown",
        email: profile?.email || "",
        stage: agent.onboarding_stage || "onboarding",
        licenseStatus: agent.license_status,
        weeklyProduction: weeklyProd,
        monthlyProduction: monthlyProd,
        courseProgress,
        needsAttention,
        attentionReason,
      };
    });

    // Calculate stats
    const totalAgents = summaries.length;
    const needsAttentionCount = summaries.filter((s) => s.needsAttention).length;
    const licensedCount = summaries.filter((s) => s.licenseStatus === "licensed").length;
    const unlicensedCount = totalAgents - licensedCount;
    const totalWeeklyProd = summaries.reduce((sum, s) => sum + s.weeklyProduction, 0);
    const totalMonthlyProd = summaries.reduce((sum, s) => sum + s.monthlyProduction, 0);

    // Build email HTML
    const attentionList = summaries
      .filter((s) => s.needsAttention)
      .map((s) => `<li><strong>${s.name}</strong>: ${s.attentionReason}</li>`)
      .join("");

    const stageBreakdown = {
      onboarding: summaries.filter((s) => s.stage === "onboarding").length,
      training_online: summaries.filter((s) => s.stage === "training_online").length,
      in_field_training: summaries.filter((s) => s.stage === "in_field_training").length,
      evaluated: summaries.filter((s) => s.stage === "evaluated").length,
    };

    const emailHtml = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h1 style="color: #1a1a1a; margin-bottom: 24px;">📊 Weekly Team Summary</h1>
        
        <div style="background: #f5f5f5; border-radius: 12px; padding: 20px; margin-bottom: 24px;">
          <h2 style="margin-top: 0; font-size: 18px;">Team Overview</h2>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
            <div>
              <p style="margin: 4px 0; color: #666;">Total Agents</p>
              <p style="margin: 4px 0; font-size: 24px; font-weight: bold;">${totalAgents}</p>
            </div>
            <div>
              <p style="margin: 4px 0; color: #666;">Licensed</p>
              <p style="margin: 4px 0; font-size: 24px; font-weight: bold; color: #22c55e;">${licensedCount}</p>
            </div>
            <div>
              <p style="margin: 4px 0; color: #666;">Weekly Production</p>
              <p style="margin: 4px 0; font-size: 24px; font-weight: bold;">$${totalWeeklyProd.toLocaleString()}</p>
            </div>
            <div>
              <p style="margin: 4px 0; color: #666;">Monthly Production</p>
              <p style="margin: 4px 0; font-size: 24px; font-weight: bold;">$${totalMonthlyProd.toLocaleString()}</p>
            </div>
          </div>
        </div>

        <div style="background: #f5f5f5; border-radius: 12px; padding: 20px; margin-bottom: 24px;">
          <h2 style="margin-top: 0; font-size: 18px;">Pipeline Breakdown</h2>
          <ul style="list-style: none; padding: 0; margin: 0;">
            <li style="padding: 8px 0; border-bottom: 1px solid #ddd;">
              <span style="color: #3b82f6;">●</span> Onboarding: <strong>${stageBreakdown.onboarding}</strong>
            </li>
            <li style="padding: 8px 0; border-bottom: 1px solid #ddd;">
              <span style="color: #f59e0b;">●</span> Training Online: <strong>${stageBreakdown.training_online}</strong>
            </li>
            <li style="padding: 8px 0; border-bottom: 1px solid #ddd;">
              <span style="color: #8b5cf6;">●</span> Field Training: <strong>${stageBreakdown.in_field_training}</strong>
            </li>
            <li style="padding: 8px 0;">
              <span style="color: #22c55e;">●</span> Evaluated: <strong>${stageBreakdown.evaluated}</strong>
            </li>
          </ul>
        </div>

        ${needsAttentionCount > 0 ? `
        <div style="background: #fef3c7; border-radius: 12px; padding: 20px; margin-bottom: 24px; border: 1px solid #f59e0b;">
          <h2 style="margin-top: 0; font-size: 18px; color: #92400e;">⚠️ Needs Attention (${needsAttentionCount})</h2>
          <ul style="margin: 0; padding-left: 20px; color: #78350f;">${attentionList}</ul>
        </div>
        ` : ''}

        <div style="text-align: center; padding: 20px;">
          <a href="https://rebuild-brighten-sparkle.lovable.app/dashboard" 
             style="display: inline-block; background: #3b82f6; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 500;">
            View Dashboard
          </a>
        </div>

        <p style="color: #999; font-size: 12px; text-align: center; margin-top: 32px;">
          Powered by Apex Financial
        </p>
      </div>
    `;

    // Send to all admins
    const emailPromises = (adminProfiles || []).map((admin) =>
      resend.emails.send({
        from: "Apex Financial <team@apex-financial.org>",
        to: [admin.email],
        subject: `📊 Weekly Team Summary - ${new Date().toLocaleDateString()}`,
        html: emailHtml,
      })
    );

    await Promise.allSettled(emailPromises);

    console.log(`Weekly summary sent to ${adminProfiles?.length || 0} admins`);

    return new Response(
      JSON.stringify({
        success: true,
        adminCount: adminProfiles?.length || 0,
        agentCount: totalAgents,
      }),
      { headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: unknown) {
    console.error("Error in weekly summary:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
};

serve(handler);
