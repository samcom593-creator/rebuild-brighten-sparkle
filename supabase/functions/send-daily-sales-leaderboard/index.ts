import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface LeaderboardEntry {
  agentId: string;
  agentName: string;
  email: string;
  deals: number;
  alp: number;
  rank: number;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("🏆 Starting daily sales leaderboard email...");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get today's date in PST
    const now = new Date();
    const pstDate = new Date(now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
    const today = pstDate.toISOString().split("T")[0];
    
    // Format date for display
    const displayDate = pstDate.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
      timeZone: "America/Los_Angeles",
    });

    console.log(`📅 Fetching production for: ${today}`);

    // Fetch today's production data
    const { data: production, error: prodError } = await supabase
      .from("daily_production")
      .select("agent_id, deals_closed, aop")
      .eq("production_date", today)
      .gt("deals_closed", 0);

    if (prodError) {
      console.error("Error fetching production:", prodError);
      throw prodError;
    }

    if (!production || production.length === 0) {
      console.log("📭 No deals closed today - skipping leaderboard email");
      return new Response(
        JSON.stringify({ success: true, message: "No deals today", sent: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`📊 Found ${production.length} agents with deals today`);

    // Get all active agents with emails
    const { data: agents, error: agentsError } = await supabase
      .from("agents")
      .select("id, user_id, is_deactivated, is_inactive")
      .eq("is_deactivated", false)
      .eq("is_inactive", false);

    if (agentsError) {
      console.error("Error fetching agents:", agentsError);
      throw agentsError;
    }

    // Get profiles for all agents
    const userIds = agents?.map(a => a.user_id).filter(Boolean) || [];
    const { data: profiles } = await supabase
      .from("profiles")
      .select("user_id, email, full_name")
      .in("user_id", userIds);

    const profileMap = new Map(profiles?.map(p => [p.user_id, p]) || []);
    const agentToProfile = new Map(agents?.map(a => [a.id, profileMap.get(a.user_id)]) || []);

    // Build leaderboard entries - sorted by ALP
    const leaderboardEntries: LeaderboardEntry[] = production
      .map(p => {
        const profile = agentToProfile.get(p.agent_id);
        return {
          agentId: p.agent_id,
          agentName: profile?.full_name || "Unknown Agent",
          email: profile?.email || "",
          deals: p.deals_closed,
          alp: Number(p.aop),
          rank: 0,
        };
      })
      .filter(e => e.email) // Only include agents with valid emails
      .sort((a, b) => b.alp - a.alp);

    // Assign ranks
    leaderboardEntries.forEach((entry, idx) => {
      entry.rank = idx + 1;
    });

    // Calculate team total
    const teamTotal = leaderboardEntries.reduce((sum, e) => sum + e.alp, 0);
    const totalDeals = leaderboardEntries.reduce((sum, e) => sum + e.deals, 0);

    console.log(`🏆 Leaderboard: ${leaderboardEntries.length} ranked agents, $${teamTotal.toLocaleString()} total ALP`);

    // Get all active agent emails to send personalized leaderboard
    const allRecipients = agents
      ?.filter(a => {
        const profile = profileMap.get(a.user_id);
        return profile?.email;
      })
      .map(a => ({
        agentId: a.id,
        email: profileMap.get(a.user_id)?.email || "",
        name: profileMap.get(a.user_id)?.full_name || "Agent",
      }))
      .filter(r => r.email) || [];

    console.log(`📧 Sending personalized leaderboard to ${allRecipients.length} agents`);

    // Generate leaderboard rows HTML
    const generateLeaderboardRows = (recipientAgentId: string) => {
      return leaderboardEntries.map(entry => {
        const isRecipient = entry.agentId === recipientAgentId;
        const rankIcon = entry.rank === 1 ? "🥇" : entry.rank === 2 ? "🥈" : entry.rank === 3 ? "🥉" : `${entry.rank}`;
        const formattedAlp = Number(entry.alp).toLocaleString("en-US", { maximumFractionDigits: 0 });
        
        return `
          <tr style="background: ${isRecipient ? 'linear-gradient(90deg, rgba(212, 175, 55, 0.15), transparent)' : 'transparent'}; ${isRecipient ? 'font-weight: 700;' : ''}">
            <td style="padding: 12px 16px; border-bottom: 1px solid rgba(255,255,255,0.1); text-align: center; font-size: 18px;">
              ${rankIcon}
            </td>
            <td style="padding: 12px 16px; border-bottom: 1px solid rgba(255,255,255,0.1); color: ${isRecipient ? '#d4af37' : 'white'};">
              ${isRecipient ? '⭐ ' : ''}${entry.agentName}${isRecipient ? ' (YOU)' : ''}
            </td>
            <td style="padding: 12px 16px; border-bottom: 1px solid rgba(255,255,255,0.1); text-align: center; color: white;">
              ${entry.deals}
            </td>
            <td style="padding: 12px 16px; border-bottom: 1px solid rgba(255,255,255,0.1); text-align: right; color: #4ade80; font-weight: 600;">
              $${formattedAlp}
            </td>
          </tr>
        `;
      }).join("");
    };

    // Generate motivational message for recipient
    const generateMotivationalMessage = (recipientAgentId: string, recipientName: string) => {
      const recipientEntry = leaderboardEntries.find(e => e.agentId === recipientAgentId);
      
      if (!recipientEntry) {
        return `<p style="color: rgba(255,255,255,0.8); font-size: 16px; margin: 0;">No deals today? Tomorrow's a new day! 💪</p>`;
      }

      if (recipientEntry.rank === 1) {
        return `<p style="color: #d4af37; font-size: 18px; font-weight: 700; margin: 0;">👑 YOU'RE #1 TODAY! Absolute domination!</p>`;
      }

      if (recipientEntry.rank <= 3) {
        return `<p style="color: #4ade80; font-size: 16px; margin: 0;">🔥 Podium finish! You're on fire!</p>`;
      }

      // Show gap to next rank
      const nextRankEntry = leaderboardEntries.find(e => e.rank === recipientEntry.rank - 1);
      if (nextRankEntry) {
        const gap = nextRankEntry.alp - recipientEntry.alp;
        return `<p style="color: rgba(255,255,255,0.8); font-size: 16px; margin: 0;">💡 You're just $${gap.toLocaleString()} away from #${recipientEntry.rank - 1}!</p>`;
      }

      return `<p style="color: rgba(255,255,255,0.8); font-size: 16px; margin: 0;">Keep pushing! Every deal counts! 🚀</p>`;
    };

    // Build personalized email HTML
    const buildEmailHtml = (recipientAgentId: string, recipientName: string) => {
      const firstName = recipientName.split(" ")[0];
      
      return `
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
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; background: linear-gradient(180deg, #1a1a1a 0%, #0d0d0d 100%); border-radius: 24px; overflow: hidden; border: 1px solid rgba(212, 175, 55, 0.3); box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);">
          
          <!-- Header -->
          <tr>
            <td style="padding: 32px 24px; text-align: center; background: linear-gradient(135deg, rgba(212, 175, 55, 0.1) 0%, transparent 100%); border-bottom: 1px solid rgba(212, 175, 55, 0.2);">
              <div style="font-size: 48px; margin-bottom: 8px;">🏆</div>
              <h1 style="color: #d4af37; font-size: 24px; font-weight: 900; margin: 0; text-transform: uppercase; letter-spacing: 2px;">
                DAILY SALES LEADERBOARD
              </h1>
              <p style="color: rgba(255,255,255,0.6); font-size: 14px; margin: 8px 0 0 0;">
                ${displayDate}
              </p>
            </td>
          </tr>
          
          <!-- Greeting -->
          <tr>
            <td style="padding: 24px 24px 16px 24px;">
              <p style="color: white; font-size: 18px; margin: 0;">Hey ${firstName},</p>
              <p style="color: rgba(255,255,255,0.7); font-size: 15px; margin: 8px 0 0 0;">Here's how the team performed today:</p>
            </td>
          </tr>
          
          <!-- Leaderboard Table -->
          <tr>
            <td style="padding: 0 24px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="background: rgba(255,255,255,0.03); border-radius: 16px; overflow: hidden; border: 1px solid rgba(255,255,255,0.1);">
                <thead>
                  <tr style="background: rgba(212, 175, 55, 0.1);">
                    <th style="padding: 14px 16px; color: #d4af37; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; text-align: center; border-bottom: 1px solid rgba(212, 175, 55, 0.2);">Rank</th>
                    <th style="padding: 14px 16px; color: #d4af37; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; text-align: left; border-bottom: 1px solid rgba(212, 175, 55, 0.2);">Agent</th>
                    <th style="padding: 14px 16px; color: #d4af37; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; text-align: center; border-bottom: 1px solid rgba(212, 175, 55, 0.2);">Deals</th>
                    <th style="padding: 14px 16px; color: #d4af37; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; text-align: right; border-bottom: 1px solid rgba(212, 175, 55, 0.2);">ALP</th>
                  </tr>
                </thead>
                <tbody>
                  ${generateLeaderboardRows(recipientAgentId)}
                </tbody>
              </table>
            </td>
          </tr>
          
          <!-- Team Total -->
          <tr>
            <td style="padding: 24px;">
              <div style="background: linear-gradient(135deg, rgba(74, 222, 128, 0.1) 0%, rgba(34, 197, 94, 0.05) 100%); border: 1px solid rgba(74, 222, 128, 0.3); border-radius: 16px; padding: 20px; text-align: center;">
                <p style="color: rgba(255,255,255,0.7); font-size: 14px; margin: 0 0 4px 0;">📊 TEAM TOTAL</p>
                <p style="color: #4ade80; font-size: 32px; font-weight: 900; margin: 0;">
                  $${teamTotal.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                </p>
                <p style="color: rgba(255,255,255,0.5); font-size: 13px; margin: 4px 0 0 0;">${totalDeals} deals closed</p>
              </div>
            </td>
          </tr>
          
          <!-- Motivational Message -->
          <tr>
            <td style="padding: 0 24px 24px 24px; text-align: center;">
              ${generateMotivationalMessage(recipientAgentId, recipientName)}
            </td>
          </tr>
          
          <!-- CTA Button -->
          <tr>
            <td style="padding: 0 24px 32px 24px; text-align: center;">
              <a href="https://rebuild-brighten-sparkle.lovable.app/numbers" 
                 style="display: inline-block; background: linear-gradient(135deg, #d4af37 0%, #b8941d 100%); color: #0a0a0a; font-size: 14px; font-weight: 800; text-decoration: none; padding: 16px 40px; border-radius: 12px; text-transform: uppercase; letter-spacing: 1px; box-shadow: 0 8px 20px rgba(212, 175, 55, 0.3);">
                🎯 LOG TOMORROW'S NUMBERS
              </a>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="padding: 20px; text-align: center; background: rgba(0,0,0,0.3); border-top: 1px solid rgba(255,255,255,0.1);">
              <p style="color: rgba(255,255,255,0.4); font-size: 12px; margin: 0;">
                Powered by APEX Financial
              </p>
            </td>
          </tr>
          
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
    };

    // Send emails in batches
    const BATCH_SIZE = 10;
    let sentCount = 0;
    let errorCount = 0;

    for (let i = 0; i < allRecipients.length; i += BATCH_SIZE) {
      const batch = allRecipients.slice(i, i + BATCH_SIZE);
      
      const results = await Promise.allSettled(
        batch.map(recipient =>
          resend.emails.send({
            from: "APEX Financial <noreply@apex-financial.org>",
            to: [recipient.email],
            subject: `🏆 Daily Sales Leaderboard - ${displayDate}`,
            html: buildEmailHtml(recipient.agentId, recipient.name),
          })
        )
      );

      results.forEach((result, idx) => {
        if (result.status === "fulfilled") {
          sentCount++;
        } else {
          errorCount++;
          console.error(`Failed to send to ${batch[idx].email}:`, result.reason);
        }
      });

      console.log(`✅ Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${batch.length} emails processed`);
    }

    console.log(`🎉 Leaderboard complete: ${sentCount} sent, ${errorCount} failed`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        sent: sentCount, 
        failed: errorCount,
        totalAgents: allRecipients.length,
        leaderboardSize: leaderboardEntries.length,
        teamTotal,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error in send-daily-sales-leaderboard:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
