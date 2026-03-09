import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));
const CALENDLY_LINK = "https://calendly.com/sam-com593/licensed-prospect-call-clone-1";

interface LowCloseRateRequest {
  agentId: string;
  closeRate: number;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { agentId, closeRate }: LowCloseRateRequest = await req.json();

    if (closeRate >= 20) {
      return new Response(
        JSON.stringify({ success: true, message: "Close rate is acceptable" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Get agent details
    const { data: agent } = await supabaseClient
      .from("agents")
      .select("user_id, invited_by_manager_id")
      .eq("id", agentId)
      .single();

    if (!agent?.user_id) {
      return new Response(
        JSON.stringify({ success: false, message: "Agent not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get agent profile
    const { data: agentProfile } = await supabaseClient
      .from("profiles")
      .select("full_name, email")
      .eq("user_id", agent.user_id)
      .single();

    const agentName = agentProfile?.full_name || "Unknown Agent";

    // Get manager email
    let managerEmail: string | null = null;
    if (agent.invited_by_manager_id) {
      const { data: managerAgent } = await supabaseClient
        .from("agents")
        .select("user_id")
        .eq("id", agent.invited_by_manager_id)
        .single();

      if (managerAgent?.user_id) {
        const { data: managerProfile } = await supabaseClient
          .from("profiles")
          .select("email")
          .eq("user_id", managerAgent.user_id)
          .single();
        
        managerEmail = managerProfile?.email || null;
      }
    }

    // Get admin emails
    const { data: adminRoles } = await supabaseClient
      .from("user_roles")
      .select("user_id")
      .eq("role", "admin");

    const adminUserIds = adminRoles?.map(r => r.user_id) || [];
    const { data: adminProfiles } = await supabaseClient
      .from("profiles")
      .select("email")
      .in("user_id", adminUserIds);

    const adminEmails = adminProfiles?.map(p => p.email).filter(Boolean) || [];
    const notifyEmails = [...new Set([...adminEmails, managerEmail].filter(Boolean))];

    if (!notifyEmails.length) {
      return new Response(
        JSON.stringify({ success: false, message: "No managers/admins to notify" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Send alert emails
    for (const email of notifyEmails) {
      try {
        await resend.emails.send({
           from: "APEX Financial Empire <notifications@apex-financial.org>",
          to: [email!],
          subject: `⚠️ Low Close Rate Alert: ${agentName} (${closeRate.toFixed(0)}%)`,
          html: `
            <!DOCTYPE html>
            <html>
            <head>
              <meta charset="utf-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
            </head>
            <body style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; padding: 0; background-color: #0a0f1a;">
              <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
                <div style="background: linear-gradient(135deg, #0d1526 0%, #1a2a4a 100%); border-radius: 16px; padding: 40px; border: 1px solid rgba(239, 68, 68, 0.3);">
                  
                  <div style="text-align: center; margin-bottom: 24px;">
                    <span style="font-size: 48px;">⚠️</span>
                  </div>
                  
                  <h1 style="color: #ef4444; font-size: 24px; margin: 0 0 16px 0; text-align: center;">
                    Low Close Rate Alert
                  </h1>
                  
                  <div style="background: rgba(239, 68, 68, 0.1); border-radius: 12px; padding: 24px; margin: 24px 0; text-align: center;">
                    <p style="color: #ffffff; font-size: 20px; font-weight: bold; margin: 0 0 8px 0;">
                      ${agentName}
                    </p>
                    <p style="color: #ef4444; font-size: 36px; font-weight: bold; margin: 0;">
                      ${closeRate.toFixed(0)}%
                    </p>
                    <p style="color: #94a3b8; font-size: 14px; margin: 8px 0 0 0;">
                      Current Close Rate (Below 20% Threshold)
                    </p>
                  </div>
                  
                  <p style="color: #e2e8f0; font-size: 16px; line-height: 1.8; margin: 0 0 24px 0;">
                    This agent's closing rate has dropped below the 20% threshold. Consider:
                  </p>
                  
                  <ul style="color: #94a3b8; font-size: 14px; line-height: 2; margin: 0 0 24px 0; padding-left: 20px;">
                    <li>Scheduling a 1-on-1 coaching call</li>
                    <li>Reviewing their presentation technique</li>
                    <li>Checking for objection handling issues</li>
                    <li>Verifying lead quality</li>
                  </ul>
                  
                  <div style="border-top: 1px solid rgba(148, 163, 184, 0.2); padding-top: 24px; margin-top: 24px;">
                    <p style="color: #64748b; font-size: 12px; margin: 0; text-align: center;">
                      APEX Financial Empire - Manager Alert System
                    </p>
                  </div>
                  
                </div>
              </div>
            </body>
            </html>
          `,
        });

        await new Promise(resolve => setTimeout(resolve, 300));
      } catch (emailError) {
        console.error(`Failed to send alert to ${email}:`, emailError);
      }
    }

    // Also send encouragement to the agent
    if (agentProfile?.email) {
      try {
        await resend.emails.send({
          from: "APEX Financial Empire <notifications@apex-financial.org>",
          to: [agentProfile.email],
          subject: "💪 Let's Work on Your Closing Game",
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
                  
                  <h1 style="color: #14b8a6; font-size: 24px; margin: 0 0 20px 0;">
                    Hey ${agentProfile.full_name?.split(" ")[0] || "there"}! 👋
                  </h1>
                  
                  <p style="color: #e2e8f0; font-size: 16px; line-height: 1.8; margin: 0 0 20px 0;">
                    I noticed your closing rate is below where we'd like it to be. Don't worry - every top producer has been here at some point.
                  </p>
                  
                  <p style="color: #e2e8f0; font-size: 16px; line-height: 1.8; margin: 0 0 20px 0;">
                    Let's get on a quick call to work on your approach. Sometimes small adjustments make a huge difference.
                  </p>
                  
                  <div style="text-align: center; margin: 32px 0;">
                    <a href="${CALENDLY_LINK}" style="display: inline-block; background: linear-gradient(135deg, #14b8a6 0%, #0d9488 100%); color: #0a0f1a; text-decoration: none; padding: 16px 40px; border-radius: 8px; font-weight: bold; font-size: 16px;">
                      Book a Coaching Call →
                    </a>
                  </div>
                  
                  <p style="color: #94a3b8; font-size: 14px; text-align: center;">
                    We're here to help you succeed! 🚀
                  </p>
                  
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
      } catch (e) {
        console.error("Failed to send agent encouragement:", e);
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `Low close rate alerts sent`,
        agentName,
        closeRate,
        notifiedEmails: notifyEmails
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Error in notify-low-close-rate:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
};

serve(handler);
