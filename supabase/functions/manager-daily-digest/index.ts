import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";

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
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

    console.log("Generating manager daily digests...");

    // Get all managers
    const { data: managerRoles } = await supabase
      .from("user_roles")
      .select("user_id")
      .eq("role", "manager");

    if (!managerRoles?.length) {
      console.log("No managers found");
      return new Response(
        JSON.stringify({ success: true, sent: 0 }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const managerUserIds = managerRoles.map(r => r.user_id);

    // Get manager agent records
    const { data: managerAgents } = await supabase
      .from("agents")
      .select("id, user_id")
      .in("user_id", managerUserIds)
      .eq("status", "active");

    if (!managerAgents?.length) {
      return new Response(
        JSON.stringify({ success: true, sent: 0 }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get manager profiles
    const { data: managerProfiles } = await supabase
      .from("profiles")
      .select("user_id, full_name, email")
      .in("user_id", managerUserIds);

    const profileMap = new Map(managerProfiles?.map(p => [p.user_id, p]) || []);

    // Get yesterday's date for production query
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split("T")[0];

    // Get this week's start (Sunday)
    const dayOfWeek = today.getDay();
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - dayOfWeek);
    const weekStartStr = weekStart.toISOString().split("T")[0];

    let sentCount = 0;
    const crmUrl = "https://rebuild-brighten-sparkle.lovable.app/crm";

    for (const manager of managerAgents) {
      const profile = profileMap.get(manager.user_id);
      if (!profile?.email) continue;

      const firstName = profile.full_name?.split(" ")[0] || "Manager";

      // Get all agents for this manager
      const { data: teamAgents } = await supabase
        .from("agents")
        .select(`
          id,
          user_id,
          onboarding_stage,
          is_deactivated,
          attendance_status,
          created_at,
          field_training_started_at
        `)
        .eq("invited_by_manager_id", manager.id)
        .eq("is_deactivated", false)
        .eq("status", "active");

      if (!teamAgents || teamAgents.length === 0) continue;

      const teamIds = teamAgents.map(a => a.id);

      // Get team production for yesterday
      const { data: yesterdayProduction } = await supabase
        .from("daily_production")
        .select("agent_id, aop, deals_closed, presentations")
        .in("agent_id", teamIds)
        .eq("production_date", yesterdayStr);

      // Get team production for the week
      const { data: weeklyProduction } = await supabase
        .from("daily_production")
        .select("agent_id, aop, deals_closed, presentations")
        .in("agent_id", teamIds)
        .gte("production_date", weekStartStr);

      // Get team profiles for names
      const teamUserIds = teamAgents.map(a => a.user_id).filter(Boolean);
      const { data: teamProfiles } = await supabase
        .from("profiles")
        .select("user_id, full_name")
        .in("user_id", teamUserIds);

      const teamProfileMap = new Map(teamProfiles?.map(p => [p.user_id, p.full_name]) || []);

      // Calculate stats
      const inCourse = teamAgents.filter(a => ["onboarding", "training_online"].includes(a.onboarding_stage || "")).length;
      const inTraining = teamAgents.filter(a => a.onboarding_stage === "in_field_training").length;
      const live = teamAgents.filter(a => a.onboarding_stage === "evaluated").length;
      const criticalAttendance = teamAgents.filter(a => a.attendance_status === "critical").length;

      // Yesterday's totals
      const yesterdayALP = yesterdayProduction?.reduce((sum, p) => sum + (Number(p.aop) || 0), 0) || 0;
      const yesterdayDeals = yesterdayProduction?.reduce((sum, p) => sum + (p.deals_closed || 0), 0) || 0;

      // Weekly totals
      const weeklyALP = weeklyProduction?.reduce((sum, p) => sum + (Number(p.aop) || 0), 0) || 0;
      const weeklyDeals = weeklyProduction?.reduce((sum, p) => sum + (p.deals_closed || 0), 0) || 0;

      // Find top producer of the week
      const weeklyByAgent = new Map<string, number>();
      weeklyProduction?.forEach(p => {
        const current = weeklyByAgent.get(p.agent_id) || 0;
        weeklyByAgent.set(p.agent_id, current + (Number(p.aop) || 0));
      });

      let topProducer = { name: "N/A", alp: 0 };
      weeklyByAgent.forEach((alp, agentId) => {
        if (alp > topProducer.alp) {
          const agent = teamAgents.find(a => a.id === agentId);
          const name = agent ? teamProfileMap.get(agent.user_id) : null;
          topProducer = { name: name || "Unknown", alp };
        }
      });

      // Find stalled agents in course (3+ days without progress)
      const { data: courseProgress } = await supabase
        .from("onboarding_progress")
        .select("agent_id, completed_at")
        .in("agent_id", teamIds);

      const stalledAgents: string[] = [];
      const courseAgentIds = teamAgents
        .filter(a => ["onboarding", "training_online"].includes(a.onboarding_stage || ""))
        .map(a => a.id);

      for (const agentId of courseAgentIds) {
        const agentProgress = courseProgress?.filter(p => p.agent_id === agentId) || [];
        const lastActivity = agentProgress
          .map(p => p.completed_at)
          .filter(Boolean)
          .sort()
          .pop();

        const agent = teamAgents.find(a => a.id === agentId);
        const refDate = lastActivity ? new Date(lastActivity) : new Date(agent?.created_at || today);
        const daysSince = Math.floor((today.getTime() - refDate.getTime()) / (1000 * 60 * 60 * 24));

        if (daysSince >= 3) {
          const name = agent ? teamProfileMap.get(agent.user_id) : null;
          if (name) stalledAgents.push(name);
        }
      }

      // Build email
      const emailHtml = `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
          </head>
          <body style="margin: 0; padding: 0; font-family: 'Helvetica Neue', Arial, sans-serif; background-color: #0f0f23;">
            <div style="max-width: 600px; margin: 0 auto; background: linear-gradient(180deg, #1a1a2e 0%, #0f0f23 100%); border-radius: 16px; overflow: hidden;">
              
              <!-- Header -->
              <div style="background: linear-gradient(135deg, #00d4ff 0%, #0099cc 100%); padding: 24px; text-align: center;">
                <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 700;">
                  ☀️ Good Morning, ${firstName}!
                </h1>
                <p style="margin: 8px 0 0; color: rgba(255,255,255,0.9); font-size: 14px;">
                  Here's your team's daily digest
                </p>
              </div>
              
              <!-- Body -->
              <div style="padding: 24px;">
                
                <!-- Team Overview -->
                <div style="display: flex; gap: 12px; margin-bottom: 24px; flex-wrap: wrap;">
                  <div style="flex: 1; min-width: 100px; background: rgba(0, 212, 255, 0.1); border: 1px solid rgba(0, 212, 255, 0.3); border-radius: 12px; padding: 16px; text-align: center;">
                    <p style="color: #888; font-size: 12px; margin: 0;">In Course</p>
                    <p style="color: #00d4ff; font-size: 28px; font-weight: 700; margin: 4px 0 0;">${inCourse}</p>
                  </div>
                  <div style="flex: 1; min-width: 100px; background: rgba(0, 212, 255, 0.1); border: 1px solid rgba(0, 212, 255, 0.3); border-radius: 12px; padding: 16px; text-align: center;">
                    <p style="color: #888; font-size: 12px; margin: 0;">In Training</p>
                    <p style="color: #00d4ff; font-size: 28px; font-weight: 700; margin: 4px 0 0;">${inTraining}</p>
                  </div>
                  <div style="flex: 1; min-width: 100px; background: rgba(0, 212, 255, 0.1); border: 1px solid rgba(0, 212, 255, 0.3); border-radius: 12px; padding: 16px; text-align: center;">
                    <p style="color: #888; font-size: 12px; margin: 0;">Live</p>
                    <p style="color: #00d4ff; font-size: 28px; font-weight: 700; margin: 4px 0 0;">${live}</p>
                  </div>
                </div>
                
                <!-- Yesterday's Production -->
                <div style="background: rgba(255, 255, 255, 0.05); border-radius: 12px; padding: 20px; margin-bottom: 16px;">
                  <h3 style="color: #e0e0e0; font-size: 14px; margin: 0 0 16px; font-weight: 600;">📊 Yesterday's Production</h3>
                  <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                    <span style="color: #888;">ALP</span>
                    <span style="color: #00ff88; font-weight: 700;">$${yesterdayALP.toLocaleString()}</span>
                  </div>
                  <div style="display: flex; justify-content: space-between;">
                    <span style="color: #888;">Deals Closed</span>
                    <span style="color: #00ff88; font-weight: 700;">${yesterdayDeals}</span>
                  </div>
                </div>
                
                <!-- Weekly Progress -->
                <div style="background: rgba(255, 255, 255, 0.05); border-radius: 12px; padding: 20px; margin-bottom: 16px;">
                  <h3 style="color: #e0e0e0; font-size: 14px; margin: 0 0 16px; font-weight: 600;">📈 This Week</h3>
                  <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                    <span style="color: #888;">Total ALP</span>
                    <span style="color: #00d4ff; font-weight: 700;">$${weeklyALP.toLocaleString()}</span>
                  </div>
                  <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                    <span style="color: #888;">Total Deals</span>
                    <span style="color: #00d4ff; font-weight: 700;">${weeklyDeals}</span>
                  </div>
                  ${topProducer.alp > 0 ? `
                  <div style="display: flex; justify-content: space-between;">
                    <span style="color: #888;">Top Producer</span>
                    <span style="color: #ffd700; font-weight: 700;">🏆 ${topProducer.name} ($${topProducer.alp.toLocaleString()})</span>
                  </div>
                  ` : ''}
                </div>
                
                <!-- Alerts Section -->
                ${(criticalAttendance > 0 || stalledAgents.length > 0) ? `
                <div style="background: rgba(255, 68, 68, 0.1); border: 1px solid rgba(255, 68, 68, 0.3); border-radius: 12px; padding: 20px; margin-bottom: 16px;">
                  <h3 style="color: #ff4444; font-size: 14px; margin: 0 0 12px; font-weight: 600;">⚠️ Needs Attention</h3>
                  ${criticalAttendance > 0 ? `
                  <p style="color: #e0e0e0; font-size: 14px; margin: 0 0 8px;">
                    <strong>${criticalAttendance}</strong> agent${criticalAttendance > 1 ? 's' : ''} with critical attendance
                  </p>
                  ` : ''}
                  ${stalledAgents.length > 0 ? `
                  <p style="color: #e0e0e0; font-size: 14px; margin: 0;">
                    <strong>Stalled in course:</strong> ${stalledAgents.join(", ")}
                  </p>
                  ` : ''}
                </div>
                ` : ''}
                
                <!-- CTA Button -->
                <div style="text-align: center; margin: 24px 0;">
                  <a href="${crmUrl}" style="display: inline-block; background: linear-gradient(135deg, #00d4ff 0%, #0099cc 100%); color: #ffffff; font-size: 14px; font-weight: 600; text-decoration: none; padding: 14px 32px; border-radius: 8px;">
                    Open Team CRM →
                  </a>
                </div>
              </div>
              
              <!-- Footer -->
              <div style="padding: 16px; text-align: center; border-top: 1px solid rgba(255,255,255,0.1);">
                <p style="color: #666; font-size: 12px; margin: 0;">
                  Powered by <span style="color: #00d4ff; font-weight: 600;">Apex Financial</span>
                </p>
              </div>
            </div>
          </body>
        </html>
      `;

      try {
        await resend.emails.send({
          from: "Apex Financial <noreply@apexfinancialmarketing.com>",
          to: [profile.email],
          subject: `☀️ ${firstName}'s Daily Digest - $${weeklyALP.toLocaleString()} this week`,
          html: emailHtml,
        });

        sentCount++;
        console.log(`Sent daily digest to ${profile.email}`);
      } catch (emailError) {
        console.error(`Failed to send digest to ${profile.email}:`, emailError);
      }
    }

    console.log(`Sent ${sentCount} manager daily digests`);

    return new Response(
      JSON.stringify({ success: true, sent: sentCount }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("Error in manager-daily-digest:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
