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

    // Get yesterday's date
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split("T")[0];

    // Get top 3 performers from yesterday
    const { data: topPerformers, error: perfError } = await supabase
      .from("daily_production")
      .select(`
        agent_id,
        aop,
        deals_closed,
        presentations,
        closing_rate,
        agents!inner (
          id,
          onboarding_stage,
          profiles!inner (
            full_name,
            email
          )
        )
      `)
      .eq("production_date", yesterdayStr)
      .eq("agents.onboarding_stage", "evaluated")
      .order("aop", { ascending: false })
      .limit(3);

    if (perfError) {
      console.error("Error fetching top performers:", perfError);
      throw perfError;
    }

    if (!topPerformers || topPerformers.length === 0) {
      console.log("No production data for yesterday");
      return new Response(JSON.stringify({ message: "No production data" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get all live agents to send email to
    const { data: allAgents, error: agentsError } = await supabase
      .from("agents")
      .select(`
        id,
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

    const medals = ["🥇", "🥈", "🥉"];
    const formattedDate = yesterday.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
    });

    // Build top performers HTML
    const topPerformersHtml = topPerformers
      .map((p: any, idx: number) => {
        const name = p.agents?.profiles?.full_name || "Agent";
        const alp = Number(p.aop || 0).toLocaleString();
        const deals = p.deals_closed || 0;
        const closeRate = Number(p.closing_rate || 0).toFixed(1);
        return `
          <tr style="border-bottom: 1px solid #1e3a5f;">
            <td style="padding: 16px; font-size: 28px; text-align: center;">${medals[idx]}</td>
            <td style="padding: 16px;">
              <div style="font-weight: 600; color: #ffffff; font-size: 16px;">${name}</div>
            </td>
            <td style="padding: 16px; text-align: right;">
              <div style="color: #14b8a6; font-weight: 700; font-size: 18px;">$${alp}</div>
              <div style="color: #94a3b8; font-size: 12px;">${deals} deals • ${closeRate}% close</div>
            </td>
          </tr>
        `;
      })
      .join("");

    const emailHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="margin: 0; padding: 0; background-color: #0a0f1a; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
        <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
          
          <!-- Header -->
          <div style="text-align: center; margin-bottom: 32px;">
            <h1 style="color: #14b8a6; font-size: 28px; margin: 0 0 8px 0;">🏆 Yesterday's Top Performers</h1>
            <p style="color: #94a3b8; font-size: 14px; margin: 0;">${formattedDate}</p>
          </div>
          
          <!-- Top 3 Table -->
          <div style="background: linear-gradient(145deg, #0f172a 0%, #1e293b 100%); border-radius: 16px; border: 1px solid #1e3a5f; overflow: hidden; margin-bottom: 32px;">
            <table style="width: 100%; border-collapse: collapse;">
              <tbody>
                ${topPerformersHtml}
              </tbody>
            </table>
          </div>
          
          <!-- Motivation -->
          <div style="background: linear-gradient(135deg, #14b8a6 0%, #0d9488 100%); border-radius: 12px; padding: 24px; text-align: center; margin-bottom: 32px;">
            <p style="color: #ffffff; font-size: 18px; font-weight: 600; margin: 0 0 8px 0;">
              Today is YOUR day to make the leaderboard! 🚀
            </p>
            <p style="color: rgba(255,255,255,0.9); font-size: 14px; margin: 0;">
              One great presentation can change everything.
            </p>
          </div>
          
          <!-- CTA -->
          <div style="text-align: center;">
            <a href="https://apex-financial.org/apex-daily-numbers" 
               style="display: inline-block; background: #14b8a6; color: #0a0f1a; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px;">
              Log Today's Numbers
            </a>
          </div>
          
          <!-- Footer -->
          <div style="text-align: center; margin-top: 40px; padding-top: 24px; border-top: 1px solid #1e3a5f;">
            <p style="color: #64748b; font-size: 12px; margin: 0;">
              APEX Financial • Building Champions Daily
            </p>
          </div>
          
        </div>
      </body>
      </html>
    `;

    // Send to all agents
    let sentCount = 0;
    for (const agent of allAgents || []) {
      const agentProfiles = agent.profiles as any;
      const email = agentProfiles?.email;
      if (!email) continue;

      try {
        await resend.emails.send({
          from: "APEX Performance <noreply@apex-financial.org>",
          to: [email],
          subject: `🏆 Yesterday's Top 3 Performers - ${formattedDate}`,
          html: emailHtml,
        });
        sentCount++;
        // Small delay to avoid rate limiting
        await new Promise((r) => setTimeout(r, 200));
      } catch (emailError) {
        console.error(`Failed to send to ${email}:`, emailError);
      }
    }

    console.log(`Top performers email sent to ${sentCount} agents`);

    return new Response(
      JSON.stringify({ success: true, sentCount }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: any) {
    console.error("Error in notify-top-performers-morning:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
