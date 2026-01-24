import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));
const PORTAL_URL = "https://rebuild-brighten-sparkle.lovable.app/agent-portal";

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Get yesterday's date
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split("T")[0];

    // Get all live agents
    const { data: liveAgents } = await supabaseClient
      .from("agents")
      .select("id, user_id")
      .eq("status", "active")
      .eq("onboarding_stage", "evaluated")
      .eq("is_deactivated", false);

    if (!liveAgents?.length) {
      return new Response(
        JSON.stringify({ success: true, message: "No live agents" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const emailsSent: string[] = [];

    for (const agent of liveAgents) {
      // Get yesterday's production
      const { data: production } = await supabaseClient
        .from("daily_production")
        .select("*")
        .eq("agent_id", agent.id)
        .eq("production_date", yesterdayStr)
        .single();

      // Get agent's weekly average for comparison
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      const { data: weeklyData } = await supabaseClient
        .from("daily_production")
        .select("aop, deals_closed, closing_rate")
        .eq("agent_id", agent.id)
        .gte("production_date", weekAgo.toISOString().split("T")[0])
        .lt("production_date", yesterdayStr);

      const avgAop = weeklyData?.length 
        ? weeklyData.reduce((sum, d) => sum + Number(d.aop), 0) / weeklyData.length 
        : 0;

      // Get profile
      const { data: profile } = await supabaseClient
        .from("profiles")
        .select("full_name, email")
        .eq("user_id", agent.user_id)
        .single();

      if (!profile?.email) continue;

      const firstName = profile.full_name?.split(" ")[0] || "Agent";
      const hadProduction = production && Number(production.aop) > 0;
      const aop = hadProduction ? Number(production.aop) : 0;
      const trend = aop > avgAop ? "up" : aop < avgAop ? "down" : "same";
      const trendPercent = avgAop > 0 ? Math.abs(((aop - avgAop) / avgAop) * 100).toFixed(0) : 0;

      try {
        await resend.emails.send({
          from: "APEX Financial Empire <notifications@tx.apex-financial.org>",
          to: [profile.email],
          subject: hadProduction 
            ? `📈 Your Performance Summary - $${aop.toLocaleString()} ALP`
            : `📊 Yesterday's Performance Summary`,
          html: `
            <!DOCTYPE html>
            <html>
            <head>
              <meta charset="utf-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
            </head>
            <body style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; padding: 0; background-color: #0a0f1a;">
              <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
                <div style="background: linear-gradient(135deg, #0d1526 0%, #1a2a4a 100%); border-radius: 16px; padding: 40px; border: 1px solid rgba(20, 184, 166, 0.2);">
                  
                  <h1 style="color: #14b8a6; font-size: 24px; margin: 0 0 8px 0;">
                    Good Morning, ${firstName}! ☀️
                  </h1>
                  
                  <p style="color: #94a3b8; font-size: 14px; margin: 0 0 24px 0;">
                    Here's your performance summary for yesterday
                  </p>
                  
                  ${hadProduction ? `
                    <div style="background: rgba(20, 184, 166, 0.1); border-radius: 12px; padding: 24px; margin: 24px 0;">
                      <div style="text-align: center;">
                        <p style="color: #14b8a6; font-size: 36px; font-weight: bold; margin: 0;">
                          $${aop.toLocaleString()}
                        </p>
                        <p style="color: #94a3b8; font-size: 14px; margin: 4px 0 0 0;">Total Production</p>
                        ${trend !== "same" ? `
                          <p style="color: ${trend === "up" ? "#10b981" : "#ef4444"}; font-size: 14px; margin: 8px 0 0 0;">
                            ${trend === "up" ? "↑" : "↓"} ${trendPercent}% vs your weekly average
                          </p>
                        ` : ""}
                      </div>
                      
                      <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-top: 20px; text-align: center;">
                        <div>
                          <p style="color: #ffffff; font-size: 20px; font-weight: bold; margin: 0;">${production.deals_closed}</p>
                          <p style="color: #94a3b8; font-size: 12px; margin: 0;">Deals</p>
                        </div>
                        <div>
                          <p style="color: #ffffff; font-size: 20px; font-weight: bold; margin: 0;">${production.presentations}</p>
                          <p style="color: #94a3b8; font-size: 12px; margin: 0;">Presentations</p>
                        </div>
                        <div>
                          <p style="color: #ffffff; font-size: 20px; font-weight: bold; margin: 0;">${Number(production.closing_rate).toFixed(0)}%</p>
                          <p style="color: #94a3b8; font-size: 12px; margin: 0;">Close Rate</p>
                        </div>
                      </div>
                    </div>
                    
                    ${Number(production.closing_rate) >= 25 ? `
                      <p style="color: #10b981; font-size: 16px; text-align: center;">
                        🔥 Great closing rate! Keep up the momentum today!
                      </p>
                    ` : `
                      <p style="color: #f59e0b; font-size: 16px; text-align: center;">
                        💪 Focus on objection handling to boost your close rate.
                      </p>
                    `}
                  ` : `
                    <div style="background: rgba(245, 158, 11, 0.1); border-radius: 12px; padding: 24px; margin: 24px 0; text-align: center;">
                      <p style="color: #f59e0b; font-size: 18px; margin: 0;">
                        No production logged yesterday
                      </p>
                      <p style="color: #94a3b8; font-size: 14px; margin: 8px 0 0 0;">
                        Let's make today count!
                      </p>
                    </div>
                  `}
                  
                  <div style="text-align: center; margin: 32px 0;">
                    <a href="${PORTAL_URL}" style="display: inline-block; background: linear-gradient(135deg, #14b8a6 0%, #0d9488 100%); color: #0a0f1a; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: bold; font-size: 14px;">
                      View Full Dashboard →
                    </a>
                  </div>
                  
                  <div style="border-top: 1px solid rgba(148, 163, 184, 0.2); padding-top: 24px; margin-top: 24px;">
                    <p style="color: #64748b; font-size: 12px; margin: 0; text-align: center;">
                      APEX Financial Empire
                    </p>
                  </div>
                  
                </div>
              </div>
            </body>
            </html>
          `,
        });

        emailsSent.push(profile.email);
        await new Promise(resolve => setTimeout(resolve, 300));
      } catch (emailError) {
        console.error(`Failed to send to ${profile.email}:`, emailError);
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `Sent ${emailsSent.length} daily summaries`,
        emailsSent 
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Error in notify-daily-summary:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
};

serve(handler);
