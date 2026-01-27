import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "npm:resend@2.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("🏆 Starting weekly champion notification...");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Calculate the week's date range (last 7 days)
    const today = new Date();
    const weekStart = new Date(today);
    weekStart.setDate(weekStart.getDate() - 7);
    
    const weekStartStr = weekStart.toISOString().split("T")[0];
    const todayStr = today.toISOString().split("T")[0];

    // Get all production from the past week
    const { data: weeklyProduction, error: prodError } = await supabase
      .from("daily_production")
      .select(`
        agent_id,
        deals_closed,
        aop,
        presentations
      `)
      .gte("production_date", weekStartStr)
      .lte("production_date", todayStr);

    if (prodError) throw prodError;

    if (!weeklyProduction || weeklyProduction.length === 0) {
      console.log("No production data for this week");
      return new Response(
        JSON.stringify({ success: true, alert_sent: false, reason: "no production" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Aggregate by agent
    const agentTotals: Record<string, { aop: number; deals: number; presentations: number }> = {};
    
    for (const prod of weeklyProduction) {
      if (!agentTotals[prod.agent_id]) {
        agentTotals[prod.agent_id] = { aop: 0, deals: 0, presentations: 0 };
      }
      agentTotals[prod.agent_id].aop += Number(prod.aop) || 0;
      agentTotals[prod.agent_id].deals += prod.deals_closed || 0;
      agentTotals[prod.agent_id].presentations += prod.presentations || 0;
    }

    // Find the champion (highest ALP)
    const sortedAgents = Object.entries(agentTotals)
      .sort(([, a], [, b]) => b.aop - a.aop);

    if (sortedAgents.length === 0) {
      return new Response(
        JSON.stringify({ success: true, alert_sent: false, reason: "no agents with production" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const [championId, championStats] = sortedAgents[0];

    // Get champion's profile
    const { data: champion, error: champError } = await supabase
      .from("agents")
      .select(`
        id,
        profile:profiles!agents_profile_id_fkey(full_name, email)
      `)
      .eq("id", championId)
      .maybeSingle();

    if (champError || !champion?.profile?.full_name) {
      console.error("Could not find champion profile");
      return new Response(
        JSON.stringify({ success: true, alert_sent: false, reason: "champion not found" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const championName = champion.profile.full_name;
    const closeRate = championStats.presentations > 0 
      ? Math.round((championStats.deals / championStats.presentations) * 100) 
      : 0;

    // Get all live agent emails
    const { data: agents, error: agentsError } = await supabase
      .from("agents")
      .select(`
        id,
        profile:profiles!agents_profile_id_fkey(email)
      `)
      .eq("is_deactivated", false)
      .eq("is_inactive", false);

    if (agentsError) throw agentsError;

    const recipients = agents
      ?.filter(a => a.profile?.email)
      .map(a => a.profile?.email)
      .filter(Boolean) as string[];

    if (recipients.length === 0) {
      return new Response(
        JSON.stringify({ success: true, alert_sent: false, reason: "no recipients" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get top 3 for the email
    const top3Html = sortedAgents.slice(0, 3).map(async ([agentId, stats], index) => {
      const { data: agent } = await supabase
        .from("agents")
        .select(`profile:profiles!agents_profile_id_fkey(full_name)`)
        .eq("id", agentId)
        .maybeSingle();
      
      const name = agent?.profile?.full_name || "Unknown";
      const medal = index === 0 ? "🥇" : index === 1 ? "🥈" : "🥉";
      
      return `
        <tr>
          <td style="padding: 12px 16px; border-bottom: 1px solid rgba(255,255,255,0.1);">
            <span style="font-size: 24px; margin-right: 8px;">${medal}</span>
            <span style="color: white; font-weight: 600;">${name}</span>
          </td>
          <td style="padding: 12px 16px; text-align: right; border-bottom: 1px solid rgba(255,255,255,0.1);">
            <span style="color: #fef08a; font-weight: 700;">$${stats.aop.toLocaleString()}</span>
          </td>
        </tr>
      `;
    });

    const top3Rows = await Promise.all(top3Html);

    const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #0a0a0a; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #0a0a0a; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 500px; background: linear-gradient(135deg, #eab308 0%, #ca8a04 100%); border-radius: 24px; overflow: hidden; box-shadow: 0 25px 50px -12px rgba(234, 179, 8, 0.5);">
          
          <!-- Champion Header -->
          <tr>
            <td style="padding: 32px 24px; text-align: center;">
              <div style="font-size: 64px; margin-bottom: 8px;">🏆</div>
              <h1 style="color: white; font-size: 28px; font-weight: 900; margin: 0; text-transform: uppercase; letter-spacing: 2px;">
                WEEKLY CHAMPION
              </h1>
            </td>
          </tr>
          
          <!-- Champion Info -->
          <tr>
            <td style="background: rgba(0,0,0,0.2); padding: 32px 24px; text-align: center;">
              <h2 style="color: white; font-size: 32px; font-weight: 900; margin: 0 0 8px 0;">
                ${championName}
              </h2>
              <p style="color: rgba(255,255,255,0.9); font-size: 18px; margin: 0 0 20px 0;">
                dominated this week! 👑
              </p>
              
              <!-- Stats -->
              <div style="background: rgba(0,0,0,0.3); border-radius: 16px; padding: 24px; margin: 20px 0;">
                <div style="font-size: 48px; font-weight: 900; color: white; margin-bottom: 8px;">
                  $${championStats.aop.toLocaleString()}
                </div>
                <p style="color: rgba(255,255,255,0.7); font-size: 14px; margin: 0;">
                  Week Total ALP
                </p>
                <div style="margin-top: 16px; display: flex; justify-content: center; gap: 24px;">
                  <div>
                    <div style="color: #fef08a; font-size: 24px; font-weight: 700;">${championStats.deals}</div>
                    <div style="color: rgba(255,255,255,0.6); font-size: 12px;">Deals</div>
                  </div>
                  <div style="width: 1px; background: rgba(255,255,255,0.2);"></div>
                  <div>
                    <div style="color: #fef08a; font-size: 24px; font-weight: 700;">${closeRate}%</div>
                    <div style="color: rgba(255,255,255,0.6); font-size: 12px;">Close Rate</div>
                  </div>
                </div>
              </div>
              
              <!-- Top 3 Leaderboard -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background: rgba(0,0,0,0.2); border-radius: 12px; margin-top: 16px;">
                ${top3Rows.join("")}
              </table>
            </td>
          </tr>
          
          <!-- New Week Challenge -->
          <tr>
            <td style="padding: 24px; text-align: center; background: rgba(0,0,0,0.1);">
              <p style="color: white; font-size: 20px; font-weight: 700; margin: 0 0 20px 0; font-style: italic;">
                "New week, new chance to be #1!"
              </p>
              <a href="https://rebuild-brighten-sparkle.lovable.app/agent-portal" 
                 style="display: inline-block; background: linear-gradient(135deg, #ffffff 0%, #f0f0f0 100%); color: #ca8a04; font-size: 16px; font-weight: 800; text-decoration: none; padding: 16px 40px; border-radius: 12px; text-transform: uppercase; letter-spacing: 1px;">
                🎯 START STRONG
              </a>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="padding: 20px; text-align: center; background: rgba(0,0,0,0.3);">
              <p style="color: rgba(255,255,255,0.5); font-size: 12px; margin: 0;">
                APEX Financial • Champions Rise Every Week 🏆
              </p>
            </td>
          </tr>
          
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

    // Send to all agents
    try {
      await resend.emails.send({
        from: "APEX Financial <noreply@apex-financial.org>",
        bcc: recipients,
        to: "alerts@apex-financial.org",
        subject: `🏆 This Week's Champion: ${championName} with $${championStats.aop.toLocaleString()} ALP!`,
        html: emailHtml,
      });
      console.log(`✅ Weekly champion alert sent to ${recipients.length} agents`);
    } catch (emailError) {
      console.error("Failed to send weekly champion alert:", emailError);
      throw emailError;
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        alert_sent: true, 
        champion: championName,
        stats: championStats,
        recipients: recipients.length 
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error in notify-weekly-champion:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
