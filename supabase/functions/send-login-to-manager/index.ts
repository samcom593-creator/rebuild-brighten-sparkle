import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));
const BASE_URL = "https://rebuild-brighten-sparkle.lovable.app";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ADMIN_EMAIL = "sam@apex-financial.org";

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { agentId } = await req.json();

    if (!agentId) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing agentId" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseClient = createClient(
      SUPABASE_URL,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Get agent details
    const { data: agent, error: agentError } = await supabaseClient
      .from("agents")
      .select("user_id, invited_by_manager_id, display_name, profile_id")
      .eq("id", agentId)
      .single();

    if (agentError || !agent) {
      return new Response(
        JSON.stringify({ success: false, error: "Agent not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!agent.invited_by_manager_id) {
      return new Response(
        JSON.stringify({ success: false, error: "Agent has no assigned manager" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get agent profile (name + email for magic link)
    let agentName = agent.display_name || "Agent";
    let agentEmail = "";

    if (agent.user_id) {
      const { data: profile } = await supabaseClient
        .from("profiles")
        .select("full_name, email")
        .eq("user_id", agent.user_id)
        .single();
      if (profile) {
        agentName = profile.full_name || agentName;
        agentEmail = profile.email || "";
      }
    } else if (agent.profile_id) {
      const { data: profile } = await supabaseClient
        .from("profiles")
        .select("full_name, email")
        .eq("id", agent.profile_id)
        .single();
      if (profile) {
        agentName = profile.full_name || agentName;
        agentEmail = profile.email || "";
      }
    }

    if (!agentEmail) {
      return new Response(
        JSON.stringify({ success: false, error: "Agent has no email on file" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get manager profile
    const { data: managerAgent } = await supabaseClient
      .from("agents")
      .select("user_id, profile_id")
      .eq("id", agent.invited_by_manager_id)
      .single();

    if (!managerAgent) {
      return new Response(
        JSON.stringify({ success: false, error: "Manager not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let managerEmail = "";
    let managerName = "Manager";

    if (managerAgent.user_id) {
      const { data: mp } = await supabaseClient
        .from("profiles")
        .select("full_name, email")
        .eq("user_id", managerAgent.user_id)
        .single();
      if (mp) {
        managerName = mp.full_name?.split(" ")[0] || "Manager";
        managerEmail = mp.email || "";
      }
    } else if (managerAgent.profile_id) {
      const { data: mp } = await supabaseClient
        .from("profiles")
        .select("full_name, email")
        .eq("id", managerAgent.profile_id)
        .single();
      if (mp) {
        managerName = mp.full_name?.split(" ")[0] || "Manager";
        managerEmail = mp.email || "";
      }
    }

    if (!managerEmail) {
      return new Response(
        JSON.stringify({ success: false, error: "Manager has no email on file" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Generate magic link for the agent
    const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');

    await supabaseClient.from("magic_login_tokens").insert({
      agent_id: agentId,
      email: agentEmail.toLowerCase().trim(),
      token,
      destination: "portal",
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    });

    const portalMagicLink = `${BASE_URL}/magic-login?token=${token}`;

    // Create tracking record
    const { data: trackingRecord } = await supabaseClient
      .from("email_tracking")
      .insert({
        agent_id: agentId,
        email_type: "login_to_manager",
        recipient_email: managerEmail,
        metadata: {
          agent_name: agentName,
          manager_name: managerName,
          magic_link: true,
        }
      })
      .select("id")
      .single();

    const trackingPixelUrl = trackingRecord
      ? `${SUPABASE_URL}/functions/v1/track-email-open?id=${trackingRecord.id}`
      : "";

    // Send email to manager
    await resend.emails.send({
      from: "APEX Financial <notifications@tx.apex-financial.org>",
      to: [managerEmail],
      cc: [ADMIN_EMAIL].filter(e => e !== managerEmail),
      subject: `🔑 Login Link for ${agentName} — Please Forward`,
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
                <span style="font-size: 64px;">🔑</span>
              </div>
              
              <h1 style="color: #14b8a6; font-size: 24px; margin: 0 0 8px 0; text-align: center;">
                Hey ${managerName}!
              </h1>
              
              <h2 style="color: #ffffff; font-size: 20px; margin: 0 0 24px 0; text-align: center;">
                Login Link for ${agentName}
              </h2>
              
              <p style="color: #e2e8f0; font-size: 15px; line-height: 1.8; margin: 0 0 16px 0;">
                It looks like <strong>${agentName}</strong> hasn't been able to access their portal yet. Here's a direct login link you can share with them — just text, DM, or hand it to them in person.
              </p>
              
              <div style="background: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.3); border-radius: 12px; padding: 20px; margin: 24px 0;">
                <p style="color: #f59e0b; font-size: 14px; font-weight: bold; margin: 0 0 8px 0;">
                  ⚡ One-Tap Login for ${agentName}
                </p>
                <p style="color: #94a3b8; font-size: 13px; margin: 0 0 16px 0;">
                  This link expires in 24 hours. Forward it or share it directly:
                </p>
                <a href="${portalMagicLink}" style="display: inline-block; background: linear-gradient(135deg, #14b8a6 0%, #0d9488 100%); color: #0a0f1a; text-decoration: none; padding: 16px 40px; border-radius: 8px; font-weight: bold; font-size: 16px;">
                  🚀 ${agentName}'s Portal Login →
                </a>
              </div>
              
              <div style="background: rgba(148, 163, 184, 0.1); border-radius: 8px; padding: 16px; margin: 24px 0;">
                <p style="color: #94a3b8; font-size: 13px; margin: 0;">
                  <strong style="color: #e2e8f0;">How to share:</strong><br>
                  Copy this link and send it via text, WhatsApp, DM, or in person:<br>
                  <span style="color: #14b8a6; word-break: break-all; font-size: 12px;">${portalMagicLink}</span>
                </p>
              </div>
              
              <div style="border-top: 1px solid rgba(148, 163, 184, 0.2); padding-top: 24px; margin-top: 32px;">
                <p style="color: #64748b; font-size: 12px; margin: 0; text-align: center;">
                  APEX Financial Empire<br>
                  Building Empires, Protecting Families
                </p>
              </div>
              
              ${trackingPixelUrl ? `<img src="${trackingPixelUrl}" width="1" height="1" style="display:none;" alt="" />` : ""}
            </div>
          </div>
        </body>
        </html>
      `,
    });

    console.log(`Login link for ${agentName} sent to manager ${managerEmail}, tracking: ${trackingRecord?.id || 'none'}`);

    return new Response(
      JSON.stringify({
        success: true,
        message: `Login link for ${agentName} sent to manager (${managerEmail})`,
        trackingId: trackingRecord?.id,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Error in send-login-to-manager:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
};

serve(handler);
