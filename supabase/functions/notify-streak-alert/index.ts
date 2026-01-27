import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "npm:resend@2.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface StreakAlertRequest {
  agentId: string;
  agentName: string;
}

interface ProductionDay {
  production_date: string;
  deals_closed: number;
  aop: number;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { agentId, agentName }: StreakAlertRequest = await req.json();

    console.log(`🔥 Checking streaks for ${agentName}...`);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get last 10 days of production for streak calculation
    const tenDaysAgo = new Date();
    tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
    const tenDaysAgoStr = tenDaysAgo.toISOString().split("T")[0];

    const { data: recentProduction, error: prodError } = await supabase
      .from("daily_production")
      .select("production_date, deals_closed, aop")
      .eq("agent_id", agentId)
      .gte("production_date", tenDaysAgoStr)
      .order("production_date", { ascending: false });

    if (prodError) {
      console.error("Error fetching production:", prodError);
      throw prodError;
    }

    // Calculate deal streak (consecutive days with deals > 0)
    let dealStreak = 0;
    const streakDays: ProductionDay[] = [];
    
    if (recentProduction && recentProduction.length > 0) {
      // Sort by date descending and check for consecutive days
      const today = new Date().toISOString().split("T")[0];
      let expectedDate = new Date(today);
      
      for (const day of recentProduction) {
        const dayDate = new Date(day.production_date);
        const expectedDateStr = expectedDate.toISOString().split("T")[0];
        
        // Check if this is the expected date (consecutive)
        if (day.production_date === expectedDateStr && day.deals_closed > 0) {
          dealStreak++;
          streakDays.push(day);
          expectedDate.setDate(expectedDate.getDate() - 1);
        } else if (day.production_date < expectedDateStr) {
          // Gap in dates - streak is broken
          break;
        } else if (day.deals_closed === 0) {
          // No deals on this day - streak is broken
          break;
        }
      }
    }

    console.log(`📊 ${agentName} has a ${dealStreak}-day deal streak`);

    // Only send alerts at milestone streaks: 3, 5, 7, 10
    const milestones = [3, 5, 7, 10];
    if (!milestones.includes(dealStreak)) {
      console.log(`Streak of ${dealStreak} is not a milestone - no alert`);
      return new Response(
        JSON.stringify({ success: true, streak: dealStreak, alert_sent: false }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Calculate total deals in streak
    const totalDeals = streakDays.reduce((sum, d) => sum + d.deals_closed, 0);
    const totalAop = streakDays.reduce((sum, d) => sum + Number(d.aop), 0);

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
      ?.filter(a => a.profile?.email && a.id !== agentId)
      .map(a => a.profile?.email)
      .filter(Boolean) as string[];

    if (recipients.length === 0) {
      return new Response(
        JSON.stringify({ success: true, streak: dealStreak, alert_sent: false, reason: "no recipients" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build streak visualization
    const streakBoxes = streakDays
      .slice(0, 7)
      .map((d, i) => `<span style="display: inline-block; background: ${i === 0 ? '#22c55e' : '#374151'}; color: white; padding: 8px 12px; border-radius: 8px; margin: 4px; font-weight: bold;">${d.deals_closed} deal${d.deals_closed > 1 ? 's' : ''}</span>`)
      .join("");

    // Get streak emoji based on length
    const streakEmoji = dealStreak >= 7 ? "🔥🔥🔥" : dealStreak >= 5 ? "🔥🔥" : "🔥";
    
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
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 500px; background: linear-gradient(135deg, #f97316 0%, #ea580c 100%); border-radius: 24px; overflow: hidden; box-shadow: 0 25px 50px -12px rgba(249, 115, 22, 0.5);">
          
          <!-- Hot Streak Header -->
          <tr>
            <td style="padding: 32px 24px; text-align: center;">
              <div style="font-size: 48px; margin-bottom: 8px;">${streakEmoji}</div>
              <h1 style="color: white; font-size: 26px; font-weight: 900; margin: 0; text-transform: uppercase; letter-spacing: 2px;">
                STREAK ALERT!
              </h1>
            </td>
          </tr>
          
          <!-- Agent Streak Info -->
          <tr>
            <td style="background: rgba(0,0,0,0.2); padding: 32px 24px; text-align: center;">
              <h2 style="color: white; font-size: 28px; font-weight: 900; margin: 0 0 8px 0;">
                ${agentName}
              </h2>
              <p style="color: rgba(255,255,255,0.9); font-size: 18px; margin: 0 0 20px 0;">
                has closed deals <span style="color: #fef08a; font-weight: 900; font-size: 24px;">${dealStreak} DAYS</span> in a row!
              </p>
              
              <!-- Streak Visualization -->
              <div style="margin: 20px 0; line-height: 2;">
                ${streakBoxes}
              </div>
              
              <div style="background: rgba(0,0,0,0.3); border-radius: 12px; padding: 16px; margin-top: 20px;">
                <p style="color: #fef08a; font-size: 24px; font-weight: 900; margin: 0;">
                  ${totalDeals} deals • $${totalAop.toLocaleString()} ALP
                </p>
                <p style="color: rgba(255,255,255,0.7); font-size: 14px; margin: 8px 0 0 0;">
                  Total during this streak
                </p>
              </div>
            </td>
          </tr>
          
          <!-- Challenge -->
          <tr>
            <td style="padding: 24px; text-align: center; background: rgba(0,0,0,0.1);">
              <p style="color: white; font-size: 20px; font-weight: 700; margin: 0 0 20px 0; font-style: italic;">
                "Start YOUR winning streak today!"
              </p>
              <a href="https://rebuild-brighten-sparkle.lovable.app/agent-portal" 
                 style="display: inline-block; background: linear-gradient(135deg, #fef08a 0%, #fbbf24 100%); color: #ea580c; font-size: 16px; font-weight: 800; text-decoration: none; padding: 16px 40px; border-radius: 12px; text-transform: uppercase; letter-spacing: 1px;">
                📊 VIEW LEADERBOARD
              </a>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="padding: 20px; text-align: center; background: rgba(0,0,0,0.3);">
              <p style="color: rgba(255,255,255,0.5); font-size: 12px; margin: 0;">
                APEX Financial • Consistency Wins 🏆
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
        subject: `🔥 ${agentName} is on a ${dealStreak}-DAY DEAL STREAK!`,
        html: emailHtml,
      });
      console.log(`✅ Streak alert sent to ${recipients.length} agents`);
    } catch (emailError) {
      console.error("Failed to send streak alert:", emailError);
      throw emailError;
    }

    return new Response(
      JSON.stringify({ success: true, streak: dealStreak, alert_sent: true, recipients: recipients.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error in notify-streak-alert:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
