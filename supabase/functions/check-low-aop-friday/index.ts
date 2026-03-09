import { serve } from "npm:@hono/node-server@1.13.8";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const ADMIN_EMAIL = "sam@apex-financial.org";
const FROM_EMAIL = "APEX Financial <notifications@apex-financial.org>";
const LOW_AOP_THRESHOLD = 5000;

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    // Get start of current week (Monday)
    const now = new Date();
    const dayOfWeek = now.getDay();
    const daysFromMonday = (dayOfWeek + 6) % 7;
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - daysFromMonday);
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);

    // Get all active agents
    const { data: agents, error: agentsError } = await supabase
      .from("agents")
      .select("id, user_id, invited_by_manager_id")
      .eq("is_deactivated", false)
      .eq("is_inactive", false);

    if (agentsError) throw agentsError;

    if (!agents?.length) {
      return new Response(
        JSON.stringify({ success: true, message: "No active agents" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get this week's production for all agents
    const { data: production, error: prodError } = await supabase
      .from("daily_production")
      .select("agent_id, aop")
      .gte("production_date", weekStart.toISOString().split("T")[0])
      .lte("production_date", weekEnd.toISOString().split("T")[0]);

    if (prodError) throw prodError;

    // Sum AOP per agent
    const aopByAgent: Record<string, number> = {};
    (production || []).forEach((row) => {
      aopByAgent[row.agent_id] = (aopByAgent[row.agent_id] || 0) + (row.aop || 0);
    });

    // Filter agents below threshold
    const lowAopAgents = agents.filter((agent) => {
      const weekAop = aopByAgent[agent.id] || 0;
      return weekAop < LOW_AOP_THRESHOLD;
    });

    if (!lowAopAgents.length) {
      return new Response(
        JSON.stringify({ success: true, message: "All agents above threshold" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get profiles for all low-AOP agents
    const userIds = lowAopAgents.map((a) => a.user_id).filter(Boolean);
    const { data: profiles } = await supabase
      .from("profiles")
      .select("user_id, email, full_name")
      .in("user_id", userIds);

    const profileMap = new Map(profiles?.map((p) => [p.user_id, p]) || []);

    // Get manager profiles
    const managerAgentIds = [...new Set(lowAopAgents.map((a) => a.invited_by_manager_id).filter(Boolean))];
    const managerProfiles: Record<string, { email: string; name: string }> = {};

    if (managerAgentIds.length > 0) {
      const { data: managerAgents } = await supabase
        .from("agents")
        .select("id, user_id")
        .in("id", managerAgentIds);

      const managerUserIds = managerAgents?.map((a) => a.user_id).filter(Boolean) || [];
      if (managerUserIds.length > 0) {
        const { data: mProfiles } = await supabase
          .from("profiles")
          .select("user_id, email, full_name")
          .in("user_id", managerUserIds);

        managerAgents?.forEach((ma) => {
          const p = mProfiles?.find((p) => p.user_id === ma.user_id);
          if (p) managerProfiles[ma.id] = { email: p.email, name: p.full_name };
        });
      }
    }

    let emailsSent = 0;

    for (const agent of lowAopAgents) {
      const profile = profileMap.get(agent.user_id);
      if (!profile?.email) continue;

      const weekAop = aopByAgent[agent.id] || 0;
      const firstName = profile.full_name?.split(" ")[0] || "Agent";

      const managerInfo = agent.invited_by_manager_id
        ? managerProfiles[agent.invited_by_manager_id]
        : null;

      const ccEmails = [ADMIN_EMAIL];
      if (managerInfo?.email) ccEmails.push(managerInfo.email);

      const emailHtml = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #0f1117; color: #e2e8f0; border-radius: 12px; overflow: hidden;">
          <div style="background: linear-gradient(135deg, #1a1f2e, #0f1117); padding: 32px; text-align: center; border-bottom: 1px solid #2d3748;">
            <h1 style="margin: 0; font-size: 24px; font-weight: 700; color: #ffffff;">Weekly AOP Check-In</h1>
            <p style="margin: 8px 0 0; color: #94a3b8; font-size: 14px;">APEX Financial</p>
          </div>
          <div style="padding: 32px;">
            <p style="font-size: 16px; margin: 0 0 16px;">Hi ${firstName} 👋</p>
            <p style="color: #cbd5e1; margin: 0 0 24px;">
              We noticed your AOP for this week is <strong style="color: #f59e0b;">$${weekAop.toLocaleString()}</strong> — below the $5,000 weekly goal.
            </p>

            <div style="background: #1e2330; border-radius: 8px; padding: 20px; margin-bottom: 24px; border: 1px solid #f59e0b40;">
              <p style="margin: 0 0 8px; font-size: 14px; color: #f59e0b; font-weight: 600;">📊 This Week</p>
              <p style="margin: 0; font-size: 32px; font-weight: 700; color: #ffffff;">$${weekAop.toLocaleString()}</p>
              <p style="margin: 4px 0 0; font-size: 13px; color: #64748b;">Goal: $5,000</p>
            </div>

            <p style="color: #94a3b8; font-size: 14px; margin: 0 0 24px;">
              There's still time to push today! Schedule a coaching call if you need support. You've got this 💪
            </p>

            <div style="text-align: center;">
              <a href="https://rebuild-brighten-sparkle.lovable.app/dashboard"
                 style="display: inline-block; padding: 12px 32px; background: #6366f1; color: #ffffff; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">
                Log My Numbers
              </a>
            </div>
          </div>
          <div style="padding: 20px 32px; border-top: 1px solid #2d3748; text-align: center;">
            <p style="font-size: 11px; color: #475569; margin: 0;">Powered by <strong style="color: #6366f1;">APEX Financial</strong></p>
          </div>
        </div>
      `;

      const emailRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: FROM_EMAIL,
          to: [profile.email],
          cc: [...new Set(ccEmails)],
          subject: `⚡ Weekly Check-In: Your AOP is $${weekAop.toLocaleString()} — Push to $5k Today!`,
          html: emailHtml,
        }),
      });

      if (emailRes.ok) {
        emailsSent++;
      } else {
        const err = await emailRes.text();
        console.error(`Failed to send to ${profile.email}:`, err);
      }
    }

    return new Response(
      JSON.stringify({ success: true, emailsSent, lowAopCount: lowAopAgents.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("check-low-aop-friday error:", err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
