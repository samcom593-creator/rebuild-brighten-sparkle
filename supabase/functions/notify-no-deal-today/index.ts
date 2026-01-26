import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CALENDLY_LINK = "https://calendly.com/sam-com593/licensed-prospect-call-clone-1";

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

    const today = new Date().toISOString().split("T")[0];
    const dayName = new Date().toLocaleDateString("en-US", { weekday: "long" });

    // Get all live agents
    const { data: liveAgents, error: agentsError } = await supabase
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

    // Get today's production
    const { data: todayProduction, error: prodError } = await supabase
      .from("daily_production")
      .select("agent_id, deals_closed")
      .eq("production_date", today);

    if (prodError) {
      console.error("Error fetching production:", prodError);
      throw prodError;
    }

    // Map agent_id to deals
    const agentDeals = new Map<string, number>();
    for (const prod of todayProduction || []) {
      agentDeals.set(prod.agent_id, prod.deals_closed || 0);
    }

    // Find agents with 0 deals or no entry
    const noDealAgents = (liveAgents || []).filter((agent: any) => {
      const deals = agentDeals.get(agent.id) || 0;
      return deals === 0;
    });

    if (noDealAgents.length === 0) {
      console.log("All agents have at least 1 deal today!");
      return new Response(
        JSON.stringify({ message: "All agents have deals", sentCount: 0 }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    let sentCount = 0;
    for (const agent of noDealAgents) {
      const agentProfiles = agent.profiles as any;
      const firstName = agentProfiles?.full_name?.split(" ")[0] || "Champion";
      const email = agentProfiles?.email;

      if (!email) continue;

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
              <div style="font-size: 48px; margin-bottom: 16px;">📋</div>
              <h1 style="color: #f59e0b; font-size: 26px; margin: 0 0 8px 0;">${dayName} Checkpoint</h1>
              <p style="color: #94a3b8; font-size: 14px; margin: 0;">End of day performance review</p>
            </div>
            
            <!-- Main Message -->
            <div style="background: linear-gradient(145deg, #0f172a 0%, #1e293b 100%); border-radius: 16px; border: 1px solid #1e3a5f; padding: 28px; margin-bottom: 24px;">
              <p style="color: #ffffff; font-size: 18px; margin: 0 0 16px 0;">
                Hey ${firstName},
              </p>
              <p style="color: #cbd5e1; font-size: 15px; line-height: 1.6; margin: 0 0 16px 0;">
                I noticed you didn't close a deal today. That happens to the best of us - but here's the thing:
              </p>
              <div style="background: rgba(245, 158, 11, 0.1); border-left: 4px solid #f59e0b; padding: 16px; border-radius: 0 8px 8px 0; margin-bottom: 16px;">
                <p style="color: #fbbf24; font-size: 16px; font-weight: 600; margin: 0;">
                  One day can change the course of your entire week.
                </p>
              </div>
              <p style="color: #cbd5e1; font-size: 15px; line-height: 1.6; margin: 0;">
                Tomorrow is a fresh opportunity. If you're feeling stuck or want to strategize, I'm here to help.
              </p>
            </div>
            
            <!-- CTA -->
            <div style="background: linear-gradient(135deg, #14b8a6 0%, #0d9488 100%); border-radius: 12px; padding: 24px; text-align: center; margin-bottom: 24px;">
              <p style="color: #ffffff; font-size: 16px; margin: 0 0 16px 0;">
                <strong>Need a quick strategy session?</strong>
              </p>
              <a href="${CALENDLY_LINK}" 
                 style="display: inline-block; background: #0a0f1a; color: #14b8a6; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 15px;">
                📞 Book a 1-on-1 Call
              </a>
              <p style="color: rgba(255,255,255,0.8); font-size: 12px; margin: 16px 0 0 0;">
                Let's get you back on track for tomorrow
              </p>
            </div>
            
            <!-- Motivation -->
            <div style="text-align: center; padding: 20px; background: rgba(20, 184, 166, 0.05); border-radius: 12px; border: 1px solid rgba(20, 184, 166, 0.1);">
              <p style="color: #14b8a6; font-size: 15px; font-style: italic; margin: 0;">
                "Success is not final, failure is not fatal: it is the courage to continue that counts."
              </p>
              <p style="color: #64748b; font-size: 12px; margin: 8px 0 0 0;">
                — Winston Churchill
              </p>
            </div>
            
            <!-- Footer -->
            <div style="text-align: center; margin-top: 32px; padding-top: 24px; border-top: 1px solid #1e3a5f;">
              <p style="color: #64748b; font-size: 12px; margin: 0;">
                APEX Financial • We believe in you 💪
              </p>
            </div>
            
          </div>
        </body>
        </html>
      `;

      try {
        await resend.emails.send({
          from: "APEX Support <noreply@apex-financial.org>",
          to: [email],
          subject: `📋 ${dayName} Checkpoint - Let's Talk Strategy`,
          html: emailHtml,
        });
        sentCount++;
        await new Promise((r) => setTimeout(r, 200));
      } catch (emailError) {
        console.error(`Failed to send to ${email}:`, emailError);
      }
    }

    console.log(`No-deal alert sent to ${sentCount} agents`);

    return new Response(
      JSON.stringify({ success: true, sentCount, totalNoDeal: noDealAgents.length }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: any) {
    console.error("Error in notify-no-deal-today:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
