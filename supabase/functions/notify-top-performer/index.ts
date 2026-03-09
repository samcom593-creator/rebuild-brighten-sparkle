import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const today = new Date().toISOString().split("T")[0];

    // Get today's production, sorted by AOP
    const { data: production, error: prodError } = await supabaseClient
      .from("daily_production")
      .select("agent_id, aop, deals_closed, presentations, closing_rate")
      .eq("production_date", today)
      .order("aop", { ascending: false })
      .limit(1);

    if (prodError) throw prodError;
    if (!production?.length || Number(production[0].aop) === 0) {
      return new Response(
        JSON.stringify({ success: true, message: "No production recorded today" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const topProduction = production[0];

    // Get top performer's name
    const { data: topAgent } = await supabaseClient
      .from("agents")
      .select("user_id")
      .eq("id", topProduction.agent_id)
      .single();

    const { data: topProfile } = await supabaseClient
      .from("profiles")
      .select("full_name")
      .eq("user_id", topAgent?.user_id)
      .single();

    const topPerformerName = topProfile?.full_name || "Unknown Agent";

    // Get all live agents to notify
    const { data: liveAgents } = await supabaseClient
      .from("agents")
      .select("id, user_id")
      .eq("status", "active")
      .eq("onboarding_stage", "evaluated")
      .eq("is_deactivated", false);

    if (!liveAgents?.length) {
      return new Response(
        JSON.stringify({ success: true, message: "No agents to notify" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // BATCH: Get all emails in one query
    const userIds = liveAgents.map(a => a.user_id).filter(Boolean);
    const { data: profiles } = await supabaseClient
      .from("profiles")
      .select("user_id, email")
      .in("user_id", userIds);

    const emails = profiles?.map(p => p.email).filter(Boolean) || [];

    if (!emails.length) {
      return new Response(
        JSON.stringify({ success: true, message: "No emails to send" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Prepare stats
    const aop = Number(topProduction.aop).toLocaleString();
    const deals = topProduction.deals_closed;
    const closeRate = Number(topProduction.closing_rate).toFixed(0);

    const emailHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; padding: 0; background-color: #0a0f1a;">
        <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
          <div style="background: linear-gradient(135deg, #0d1526 0%, #1a2a4a 100%); border-radius: 16px; padding: 40px; border: 1px solid rgba(245, 158, 11, 0.3);">
            
            <div style="text-align: center; margin-bottom: 24px;">
              <span style="font-size: 64px;">🏆</span>
            </div>
            
            <h1 style="color: #f59e0b; font-size: 28px; margin: 0 0 8px 0; text-align: center;">
              Today's Champion!
            </h1>
            
            <h2 style="color: #ffffff; font-size: 32px; margin: 0 0 24px 0; text-align: center;">
              ${topPerformerName}
            </h2>
            
            <div style="background: rgba(245, 158, 11, 0.1); border-radius: 12px; padding: 24px; margin: 24px 0;">
              <table width="100%" cellpadding="0" cellspacing="0" style="text-align: center;">
                <tr>
                  <td style="width: 33%;">
                    <p style="color: #f59e0b; font-size: 28px; font-weight: bold; margin: 0;">$${aop}</p>
                    <p style="color: #94a3b8; font-size: 14px; margin: 4px 0 0 0;">Production</p>
                  </td>
                  <td style="width: 33%;">
                    <p style="color: #14b8a6; font-size: 28px; font-weight: bold; margin: 0;">${deals}</p>
                    <p style="color: #94a3b8; font-size: 14px; margin: 4px 0 0 0;">Deals Closed</p>
                  </td>
                  <td style="width: 33%;">
                    <p style="color: #8b5cf6; font-size: 28px; font-weight: bold; margin: 0;">${closeRate}%</p>
                    <p style="color: #94a3b8; font-size: 14px; margin: 4px 0 0 0;">Close Rate</p>
                  </td>
                </tr>
              </table>
            </div>
            
            <p style="color: #e2e8f0; font-size: 16px; line-height: 1.8; text-align: center; margin: 0;">
              Congratulations on an amazing day! 🎉<br>
              Let's all aim to be on top tomorrow!
            </p>
            
            <div style="border-top: 1px solid rgba(148, 163, 184, 0.2); padding-top: 24px; margin-top: 24px;">
              <p style="color: #64748b; font-size: 12px; margin: 0; text-align: center;">
                APEX Financial Empire<br>
                Building Empires, Protecting Families
              </p>
            </div>
            
          </div>
        </div>
      </body>
      </html>
    `;

    // BATCH: Send emails in parallel batches of 10
    const BATCH_SIZE = 10;
    let successCount = 0;

    for (let i = 0; i < emails.length; i += BATCH_SIZE) {
      const batch = emails.slice(i, i + BATCH_SIZE);
      
      const results = await Promise.allSettled(
        batch.map(email => 
          resend.emails.send({
            from: "APEX Financial <notifications@apex-financial.org>",
            to: [email],
            cc: ["sam@apex-financial.org"],
            subject: `🏆 Today's Top Performer: ${topPerformerName}!`,
            html: emailHtml,
          })
        )
      );

      results.forEach((result) => {
        if (result.status === "fulfilled") {
          successCount++;
        } else {
          console.error("Email send failed:", result.reason);
        }
      });
    }

    console.log(`Sent ${successCount} top performer notifications`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        topPerformer: topPerformerName,
        production: aop,
        emailsSent: successCount
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Error in notify-top-performer:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
};

serve(handler);
