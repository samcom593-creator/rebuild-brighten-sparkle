import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));
const PORTAL_URL = "https://rebuild-brighten-sparkle.lovable.app/agent-portal";

interface SendLoginRequest {
  agentId: string;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { agentId }: SendLoginRequest = await req.json();

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Get agent details
    const { data: agent, error: agentError } = await supabaseClient
      .from("agents")
      .select("user_id, onboarding_stage")
      .eq("id", agentId)
      .single();

    if (agentError || !agent?.user_id) {
      return new Response(
        JSON.stringify({ success: false, message: "Agent not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get profile
    const { data: profile } = await supabaseClient
      .from("profiles")
      .select("full_name, email")
      .eq("user_id", agent.user_id)
      .single();

    if (!profile?.email) {
      return new Response(
        JSON.stringify({ success: false, message: "Profile email not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const firstName = profile.full_name?.split(" ")[0] || "Agent";

    try {
      await resend.emails.send({
        from: "APEX Financial Empire <notifications@tx.apex-financial.org>",
        to: [profile.email],
        subject: "🎉 Welcome to the Agent Portal - You're LIVE!",
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
          </head>
          <body style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; padding: 0; background-color: #0a0f1a;">
            <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
              <div style="background: linear-gradient(135deg, #0d1526 0%, #1a2a4a 100%); border-radius: 16px; padding: 40px; border: 1px solid rgba(20, 184, 166, 0.3);">
                
                <div style="text-align: center; margin-bottom: 24px;">
                  <span style="font-size: 64px;">🚀</span>
                </div>
                
                <h1 style="color: #14b8a6; font-size: 28px; margin: 0 0 16px 0; text-align: center;">
                  Congratulations, ${firstName}!
                </h1>
                
                <h2 style="color: #ffffff; font-size: 22px; margin: 0 0 24px 0; text-align: center;">
                  You're Now LIVE!
                </h2>
                
                <p style="color: #e2e8f0; font-size: 16px; line-height: 1.8; margin: 0 0 24px 0;">
                  You've officially made it through training and are now a live agent. This is where the real journey begins!
                </p>
                
                <div style="background: rgba(20, 184, 166, 0.1); border-radius: 12px; padding: 24px; margin: 24px 0;">
                  <h3 style="color: #14b8a6; font-size: 18px; margin: 0 0 16px 0;">Your Agent Portal</h3>
                  <p style="color: #94a3b8; font-size: 14px; line-height: 1.8; margin: 0;">
                    Log in daily to:
                  </p>
                  <ul style="color: #e2e8f0; font-size: 14px; line-height: 2; margin: 8px 0 0 0; padding-left: 20px;">
                    <li>Enter your daily production numbers</li>
                    <li>Track your performance vs the team</li>
                    <li>See the live leaderboard</li>
                    <li>Celebrate your wins!</li>
                  </ul>
                </div>
                
                <div style="text-align: center; margin: 32px 0;">
                  <a href="${PORTAL_URL}" style="display: inline-block; background: linear-gradient(135deg, #14b8a6 0%, #0d9488 100%); color: #0a0f1a; text-decoration: none; padding: 16px 48px; border-radius: 8px; font-weight: bold; font-size: 16px;">
                    Access Agent Portal →
                  </a>
                </div>
                
                <p style="color: #94a3b8; font-size: 14px; text-align: center; margin: 0;">
                  Log in with your email: <strong style="color: #14b8a6;">${profile.email}</strong>
                </p>
                
                <div style="background: rgba(245, 158, 11, 0.1); border-left: 4px solid #f59e0b; padding: 16px; margin: 24px 0; border-radius: 0 12px 12px 0;">
                  <p style="color: #f59e0b; font-size: 14px; font-weight: bold; margin: 0 0 4px 0;">
                    Daily Expectation
                  </p>
                  <p style="color: #94a3b8; font-size: 14px; margin: 0;">
                    Log your numbers every day by 7 PM to stay on track!
                  </p>
                </div>
                
                <div style="border-top: 1px solid rgba(148, 163, 184, 0.2); padding-top: 24px; margin-top: 32px;">
                  <p style="color: #64748b; font-size: 12px; margin: 0; text-align: center;">
                    APEX Financial Empire<br>
                    Building Empires, Protecting Families
                  </p>
                </div>
                
              </div>
            </div>
          </body>
          </html>
        `,
      });

      // Mark portal password as not set (they need to set up)
      await supabaseClient
        .from("agents")
        .update({ portal_password_set: false })
        .eq("id", agentId);

      return new Response(
        JSON.stringify({ 
          success: true, 
          message: `Portal login sent to ${profile.email}`
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } catch (emailError: any) {
      console.error("Failed to send portal login email:", emailError);
      return new Response(
        JSON.stringify({ success: false, error: emailError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  } catch (error: any) {
    console.error("Error in send-agent-portal-login:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
};

serve(handler);
