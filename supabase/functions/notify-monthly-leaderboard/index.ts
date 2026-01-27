import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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

    // Get last month's date range
    const now = new Date();
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
    
    const startDate = lastMonth.toISOString().split("T")[0];
    const endDate = lastMonthEnd.toISOString().split("T")[0];
    const monthName = lastMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    const newMonthName = now.toLocaleDateString("en-US", { month: "long", year: "numeric" });

    // Get all production for last month grouped by agent
    const { data: monthlyData, error: dataError } = await supabase
      .from("daily_production")
      .select(`
        agent_id,
        aop,
        deals_closed,
        presentations
      `)
      .gte("production_date", startDate)
      .lte("production_date", endDate);

    if (dataError) {
      console.error("Error fetching monthly data:", dataError);
      throw dataError;
    }

    // Aggregate by agent
    const agentTotals: Record<string, { aop: number; deals: number; presentations: number }> = {};
    for (const row of monthlyData || []) {
      if (!agentTotals[row.agent_id]) {
        agentTotals[row.agent_id] = { aop: 0, deals: 0, presentations: 0 };
      }
      agentTotals[row.agent_id].aop += Number(row.aop || 0);
      agentTotals[row.agent_id].deals += Number(row.deals_closed || 0);
      agentTotals[row.agent_id].presentations += Number(row.presentations || 0);
    }

    // Get agent profiles
    const { data: agents, error: agentsError } = await supabase
      .from("agents")
      .select(`
        id,
        onboarding_stage,
        is_deactivated,
        profiles!inner (
          full_name,
          email
        )
      `)
      .eq("onboarding_stage", "evaluated")
      .eq("is_deactivated", false);

    if (agentsError) {
      console.error("Error fetching agents:", agentsError);
      throw agentsError;
    }

    // Build leaderboard
    const leaderboard = (agents || [])
      .map((agent: any) => {
        const totals = agentTotals[agent.id] || { aop: 0, deals: 0, presentations: 0 };
        const closeRate = totals.presentations > 0 
          ? (totals.deals / totals.presentations) * 100 
          : 0;
        return {
          id: agent.id,
          name: agent.profiles?.full_name || "Agent",
          email: agent.profiles?.email,
          aop: totals.aop,
          deals: totals.deals,
          presentations: totals.presentations,
          closeRate,
        };
      })
      .sort((a, b) => b.aop - a.aop);

    const medals = ["🥇", "🥈", "🥉"];

    // Build leaderboard HTML
    const leaderboardHtml = leaderboard
      .slice(0, 10)
      .map((agent, idx) => {
        const medal = idx < 3 ? medals[idx] : `${idx + 1}.`;
        const rowBg = idx < 3 ? "background: linear-gradient(90deg, rgba(20,184,166,0.1) 0%, transparent 100%);" : "";
        return `
          <tr style="border-bottom: 1px solid #1e3a5f; ${rowBg}">
            <td style="padding: 12px 16px; font-size: ${idx < 3 ? '24px' : '14px'}; text-align: center; color: #94a3b8;">${medal}</td>
            <td style="padding: 12px 16px; color: #ffffff; font-weight: ${idx < 3 ? '600' : '400'};">${agent.name}</td>
            <td style="padding: 12px 16px; text-align: right; color: #14b8a6; font-weight: 700;">$${agent.aop.toLocaleString()}</td>
            <td style="padding: 12px 16px; text-align: right; color: #94a3b8;">${agent.deals}</td>
            <td style="padding: 12px 16px; text-align: right; color: #94a3b8;">${agent.closeRate.toFixed(1)}%</td>
          </tr>
        `;
      })
      .join("");

    const totalAgencyALP = leaderboard.reduce((sum, a) => sum + a.aop, 0);
    const totalDeals = leaderboard.reduce((sum, a) => sum + a.deals, 0);

    const emailHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="margin: 0; padding: 0; background-color: #0a0f1a; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
        <div style="max-width: 700px; margin: 0 auto; padding: 40px 20px;">
          
          <!-- Header -->
          <div style="text-align: center; margin-bottom: 32px;">
            <h1 style="color: #14b8a6; font-size: 32px; margin: 0 0 8px 0;">📊 ${monthName} Final Standings</h1>
            <p style="color: #94a3b8; font-size: 16px; margin: 0;">The official monthly leaderboard is in!</p>
          </div>
          
          <!-- Agency Totals -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 32px;">
            <tr>
              <td width="48%" style="background: linear-gradient(145deg, #0f172a 0%, #1e293b 100%); border-radius: 12px; border: 1px solid #1e3a5f; padding: 20px; text-align: center;">
                <div style="color: #14b8a6; font-size: 28px; font-weight: 700;">$${totalAgencyALP.toLocaleString()}</div>
                <div style="color: #94a3b8; font-size: 12px; text-transform: uppercase;">Total ALP</div>
              </td>
              <td width="4%"></td>
              <td width="48%" style="background: linear-gradient(145deg, #0f172a 0%, #1e293b 100%); border-radius: 12px; border: 1px solid #1e3a5f; padding: 20px; text-align: center;">
                <div style="color: #ffffff; font-size: 28px; font-weight: 700;">${totalDeals}</div>
                <div style="color: #94a3b8; font-size: 12px; text-transform: uppercase;">Total Deals</div>
              </td>
            </tr>
          </table>
          
          <!-- Leaderboard Table -->
          <div style="background: linear-gradient(145deg, #0f172a 0%, #1e293b 100%); border-radius: 16px; border: 1px solid #1e3a5f; overflow: hidden; margin-bottom: 32px;">
            <table style="width: 100%; border-collapse: collapse;">
              <thead>
                <tr style="background: #0f172a; border-bottom: 2px solid #14b8a6;">
                  <th style="padding: 12px 16px; text-align: center; color: #64748b; font-size: 11px; text-transform: uppercase;">Rank</th>
                  <th style="padding: 12px 16px; text-align: left; color: #64748b; font-size: 11px; text-transform: uppercase;">Agent</th>
                  <th style="padding: 12px 16px; text-align: right; color: #64748b; font-size: 11px; text-transform: uppercase;">ALP</th>
                  <th style="padding: 12px 16px; text-align: right; color: #64748b; font-size: 11px; text-transform: uppercase;">Deals</th>
                  <th style="padding: 12px 16px; text-align: right; color: #64748b; font-size: 11px; text-transform: uppercase;">Close %</th>
                </tr>
              </thead>
              <tbody>
                ${leaderboardHtml}
              </tbody>
            </table>
          </div>
          
          <!-- New Month CTA -->
          <div style="background: linear-gradient(135deg, #14b8a6 0%, #0d9488 100%); border-radius: 12px; padding: 28px; text-align: center; margin-bottom: 32px;">
            <h2 style="color: #ffffff; font-size: 22px; margin: 0 0 12px 0;">
              🚀 Fresh Start: ${newMonthName}
            </h2>
            <p style="color: rgba(255,255,255,0.9); font-size: 15px; margin: 0 0 20px 0;">
              Set your income goal for the new month and track your progress!
            </p>
            <a href="https://apex-financial.org/agent-portal" 
               style="display: inline-block; background: #0a0f1a; color: #14b8a6; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px;">
              Set My Monthly Goal →
            </a>
          </div>
          
          <!-- Footer -->
          <div style="text-align: center; padding-top: 24px; border-top: 1px solid #1e3a5f;">
            <p style="color: #64748b; font-size: 12px; margin: 0;">
              APEX Financial • Building Champions Monthly
            </p>
          </div>
          
        </div>
      </body>
      </html>
    `;

    // Send to all agents
    let sentCount = 0;
    for (const agent of leaderboard) {
      if (!agent.email) continue;

      try {
        await resend.emails.send({
          from: "APEX Performance <noreply@apex-financial.org>",
          to: [agent.email],
          subject: `📊 ${monthName} Final Leaderboard - See Where You Ranked!`,
          html: emailHtml,
        });
        sentCount++;
        await new Promise((r) => setTimeout(r, 200));
      } catch (emailError) {
        console.error(`Failed to send to ${agent.email}:`, emailError);
      }
    }

    console.log(`Monthly leaderboard sent to ${sentCount} agents`);

    return new Response(
      JSON.stringify({ success: true, sentCount, monthName }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: any) {
    console.error("Error in notify-monthly-leaderboard:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
