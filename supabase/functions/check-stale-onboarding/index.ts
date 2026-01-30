import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface StaleAgent {
  agentId: string;
  agentName: string;
  email: string;
  stage: string;
  daysSinceActivity: number;
  completedModules: number;
  totalModules: number;
  managerEmail: string | null;
  managerName: string | null;
}

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

    console.log("Checking for stale onboarding agents...");

    // Get all modules count
    const { data: modules } = await supabase
      .from("onboarding_modules")
      .select("id")
      .eq("is_active", true);
    const totalModules = modules?.length || 0;

    // Get agents in onboarding/training_online stages
    const { data: agents, error: agentsError } = await supabase
      .from("agents")
      .select(`
        id,
        user_id,
        onboarding_stage,
        invited_by_manager_id,
        created_at
      `)
      .in("onboarding_stage", ["onboarding", "training_online"])
      .eq("is_deactivated", false)
      .eq("status", "active");

    if (agentsError) {
      console.error("Error fetching agents:", agentsError);
      throw agentsError;
    }

    if (!agents || agents.length === 0) {
      console.log("No agents in onboarding stages");
      return new Response(
        JSON.stringify({ success: true, checked: 0, stale: 0 }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const agentIds = agents.map(a => a.id);
    const userIds = agents.map(a => a.user_id).filter(Boolean);
    const managerIds = [...new Set(agents.map(a => a.invited_by_manager_id).filter(Boolean))];

    // Get profiles
    const { data: profiles } = await supabase
      .from("profiles")
      .select("user_id, full_name, email")
      .in("user_id", userIds);

    const profileMap = new Map(profiles?.map(p => [p.user_id, p]) || []);

    // Get manager profiles
    let managerMap = new Map<string, { name: string; email: string }>();
    if (managerIds.length > 0) {
      const { data: managerAgents } = await supabase
        .from("agents")
        .select("id, user_id")
        .in("id", managerIds);

      if (managerAgents?.length) {
        const managerUserIds = managerAgents.map(a => a.user_id).filter(Boolean);
        const { data: managerProfiles } = await supabase
          .from("profiles")
          .select("user_id, full_name, email")
          .in("user_id", managerUserIds);

        managerAgents.forEach(ma => {
          const mp = managerProfiles?.find(p => p.user_id === ma.user_id);
          if (mp) {
            managerMap.set(ma.id, { name: mp.full_name || "Manager", email: mp.email });
          }
        });
      }
    }

    // Get progress for all agents
    const { data: progress } = await supabase
      .from("onboarding_progress")
      .select("agent_id, passed, completed_at, video_watched_percent, started_at")
      .in("agent_id", agentIds);

    // Get last reminder sent timestamps
    const { data: emailTracking } = await supabase
      .from("email_tracking")
      .select("agent_id, sent_at, email_type")
      .in("agent_id", agentIds)
      .in("email_type", ["stale_reminder_day3", "stale_reminder_day7"]);

    const reminderMap = new Map<string, { day3: string | null; day7: string | null }>();
    emailTracking?.forEach(t => {
      const existing = reminderMap.get(t.agent_id) || { day3: null, day7: null };
      if (t.email_type === "stale_reminder_day3") existing.day3 = t.sent_at;
      if (t.email_type === "stale_reminder_day7") existing.day7 = t.sent_at;
      reminderMap.set(t.agent_id, existing);
    });

    // Calculate stale status for each agent
    const now = new Date();
    const staleAgents: StaleAgent[] = [];

    for (const agent of agents) {
      const profile = profileMap.get(agent.user_id);
      if (!profile?.email) continue;

      const agentProgress = progress?.filter(p => p.agent_id === agent.id) || [];
      const completedModules = agentProgress.filter(p => p.passed).length;
      
      // Find last activity date
      let lastActivity: Date | null = null;
      for (const p of agentProgress) {
        if (p.completed_at) {
          const d = new Date(p.completed_at);
          if (!lastActivity || d > lastActivity) lastActivity = d;
        }
        if (p.started_at) {
          const d = new Date(p.started_at);
          if (!lastActivity || d > lastActivity) lastActivity = d;
        }
      }

      // If no progress, use agent creation date
      if (!lastActivity) {
        lastActivity = new Date(agent.created_at);
      }

      const daysSinceActivity = Math.floor((now.getTime() - lastActivity.getTime()) / (1000 * 60 * 60 * 24));
      
      // Skip if course is complete
      if (completedModules >= totalModules && totalModules > 0) continue;

      // Only flag if stale (3+ days)
      if (daysSinceActivity >= 3) {
        const manager = agent.invited_by_manager_id ? managerMap.get(agent.invited_by_manager_id) : null;
        
        staleAgents.push({
          agentId: agent.id,
          agentName: profile.full_name || "Agent",
          email: profile.email,
          stage: agent.onboarding_stage,
          daysSinceActivity,
          completedModules,
          totalModules,
          managerEmail: manager?.email || null,
          managerName: manager?.name || null,
        });
      }
    }

    console.log(`Found ${staleAgents.length} stale agents`);

    // Send escalating reminders
    const results = { sent: 0, skipped: 0 };
    const courseUrl = "https://rebuild-brighten-sparkle.lovable.app/onboarding-course";

    for (const agent of staleAgents) {
      const reminders = reminderMap.get(agent.agentId) || { day3: null, day7: null };
      const firstName = agent.agentName.split(" ")[0];
      const percentComplete = agent.totalModules > 0 ? Math.round((agent.completedModules / agent.totalModules) * 100) : 0;

      let emailType: string | null = null;
      let subject = "";
      let urgencyLevel = "";

      // Determine which reminder to send
      if (agent.daysSinceActivity >= 7 && !reminders.day7) {
        emailType = "stale_reminder_day7";
        subject = `⚠️ ${firstName}, we're worried about you`;
        urgencyLevel = "critical";
      } else if (agent.daysSinceActivity >= 3 && !reminders.day3) {
        emailType = "stale_reminder_day3";
        subject = `Hey ${firstName}, we noticed you've been away`;
        urgencyLevel = "warning";
      }

      if (!emailType) {
        results.skipped++;
        continue;
      }

      const isCritical = urgencyLevel === "critical";
      const urgencyColor = isCritical ? "#ff4444" : "#ffaa00";
      const urgencyText = isCritical 
        ? "It's been a week since your last activity. We want to make sure you succeed!"
        : "It's been a few days since you've been active. Let's get you back on track!";

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
              <div style="background: linear-gradient(135deg, ${urgencyColor} 0%, ${isCritical ? '#cc0000' : '#cc8800'} 100%); padding: 32px; text-align: center;">
                <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 700;">
                  ${isCritical ? '⚠️ We Miss You!' : '👋 Come Back!'}
                </h1>
              </div>
              
              <!-- Body -->
              <div style="padding: 32px;">
                <p style="color: #e0e0e0; font-size: 18px; line-height: 1.6; margin: 0 0 24px;">
                  Hey ${firstName}!
                </p>
                
                <p style="color: #b0b0b0; font-size: 16px; line-height: 1.6; margin: 0 0 24px;">
                  ${urgencyText}
                </p>
                
                <!-- Progress Box -->
                <div style="background: rgba(${isCritical ? '255, 68, 68' : '255, 170, 0'}, 0.1); border: 1px solid rgba(${isCritical ? '255, 68, 68' : '255, 170, 0'}, 0.3); border-radius: 12px; padding: 20px; margin: 24px 0;">
                  <p style="color: #e0e0e0; font-size: 14px; margin: 0 0 8px;">Days Since Last Activity:</p>
                  <p style="color: ${urgencyColor}; font-size: 32px; font-weight: 700; margin: 0;">
                    ${agent.daysSinceActivity} days
                  </p>
                  <p style="color: #888; font-size: 14px; margin: 16px 0 0;">
                    Course Progress: ${agent.completedModules}/${agent.totalModules} modules (${percentComplete}%)
                  </p>
                </div>
                
                <p style="color: #b0b0b0; font-size: 16px; line-height: 1.6; margin: 0 0 24px;">
                  ${isCritical 
                    ? "If you're having trouble or need help, please reach out to your manager. We're here to support you!"
                    : "Just a few more modules and you'll be ready to start earning. Every successful agent started where you are now."}
                </p>
                
                <!-- CTA Button -->
                <div style="text-align: center; margin: 32px 0;">
                  <a href="${courseUrl}" style="display: inline-block; background: linear-gradient(135deg, #00d4ff 0%, #0099cc 100%); color: #ffffff; font-size: 16px; font-weight: 600; text-decoration: none; padding: 16px 40px; border-radius: 8px; box-shadow: 0 4px 15px rgba(0, 212, 255, 0.3);">
                    Resume My Course →
                  </a>
                </div>
                
                ${agent.managerName ? `
                <p style="color: #888; font-size: 14px; text-align: center; margin-top: 24px;">
                  Your manager, ${agent.managerName}, is also here to help if you need anything.
                </p>
                ` : ''}
              </div>
              
              <!-- Footer -->
              <div style="padding: 24px; text-align: center; border-top: 1px solid rgba(255,255,255,0.1);">
                <p style="color: #666; font-size: 12px; margin: 0;">
                  Powered by <span style="color: #00d4ff; font-weight: 600;">Apex Financial</span>
                </p>
              </div>
            </div>
          </body>
        </html>
      `;

      try {
        // Send to agent
        await resend.emails.send({
          from: "Apex Financial <noreply@apexfinancialmarketing.com>",
          to: [agent.email],
          subject,
          html: emailHtml,
        });

        // Also notify manager if critical
        if (isCritical && agent.managerEmail) {
          await resend.emails.send({
            from: "Apex Financial <noreply@apexfinancialmarketing.com>",
            to: [agent.managerEmail],
            subject: `⚠️ Agent Alert: ${agent.agentName} stalled in course`,
            html: `
              <div style="font-family: sans-serif; max-width: 500px;">
                <h2 style="color: #ff4444;">Agent Needs Attention</h2>
                <p><strong>${agent.agentName}</strong> has been inactive in their training course for <strong>${agent.daysSinceActivity} days</strong>.</p>
                <p>Progress: ${agent.completedModules}/${agent.totalModules} modules (${percentComplete}%)</p>
                <p>Consider reaching out to check on them and help them get back on track.</p>
                <p style="color: #888; font-size: 12px; margin-top: 24px;">Powered by Apex Financial</p>
              </div>
            `,
          });
        }

        // Track the email
        await supabase.from("email_tracking").insert({
          agent_id: agent.agentId,
          email_type: emailType,
          recipient_email: agent.email,
          sent_at: new Date().toISOString(),
        });

        results.sent++;
        console.log(`Sent ${emailType} reminder to ${agent.email}`);
      } catch (emailError) {
        console.error(`Failed to send reminder to ${agent.email}:`, emailError);
      }
    }

    console.log(`Stale check complete: ${results.sent} sent, ${results.skipped} skipped`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        checked: agents.length,
        stale: staleAgents.length,
        ...results 
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("Error in check-stale-onboarding:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
