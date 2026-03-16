import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));
const BASE_URL = "https://apex-financial.org";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { email, type } = await req.json();

    if (!email) {
      return new Response(
        JSON.stringify({ error: "Email is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseClient = createClient(
      SUPABASE_URL,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    const normalizedEmail = email.toLowerCase().trim();

    if (type === "magic_link") {
      // Look up agent by email (check profiles first, then agents display_name)
      const { data: profile } = await supabaseClient
        .from("profiles")
        .select("user_id, full_name, email")
        .eq("email", normalizedEmail)
        .maybeSingle();

      if (!profile) {
        // Don't reveal whether email exists
        console.log("No profile found for email:", normalizedEmail);
        return new Response(
          JSON.stringify({ success: true, message: "If an account exists, a link has been sent." }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Find agent record
      const { data: agent } = await supabaseClient
        .from("agents")
        .select("id")
        .eq("user_id", profile.user_id)
        .maybeSingle();

      if (!agent) {
        return new Response(
          JSON.stringify({ success: true, message: "If an account exists, a link has been sent." }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Generate magic token
      const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
      await supabaseClient.from("magic_login_tokens").insert({
        agent_id: agent.id,
        email: normalizedEmail,
        token,
        destination: "portal",
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });

      const magicLink = `${BASE_URL}/magic-login?token=${token}`;
      const firstName = profile.full_name?.split(" ")[0] || "there";

      await resend.emails.send({
         from: "APEX Financial <notifications@apex-financial.org>",
        to: [normalizedEmail],
        subject: "Your New Login Link – APEX",
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 20px;">
            <div style="text-align: center; margin-bottom: 24px;">
              <h1 style="font-size: 24px; font-weight: 700; color: #1a1a2e; margin: 0;">APEX Financial</h1>
            </div>
            <p style="font-size: 16px; color: #333; margin-bottom: 16px;">Hey ${firstName},</p>
            <p style="font-size: 14px; color: #555; margin-bottom: 24px;">Here's your new login link. Click below to access your portal:</p>
            <div style="text-align: center; margin-bottom: 24px;">
              <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 auto;">
                <tr>
                  <td align="center" bgcolor="#7c3aed" style="border-radius:8px;">
                    <a href="${magicLink}" style="display:inline-block;color:#ffffff;padding:14px 32px;text-decoration:none;font-weight:600;font-size:16px;">
                      Sign In to Portal
                    </a>
                  </td>
                </tr>
              </table>
            </div>
            <p style="font-size: 12px; color: #999; text-align: center;">This link expires in 24 hours.</p>
            <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
            <p style="font-size: 11px; color: #aaa; text-align: center;">Powered by Apex Financial</p>
          </div>
        `,
      });

      console.log("Magic link email sent to:", normalizedEmail);
      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Default: password reset type
    // Generate a recovery link via admin API
    const { data: linkData, error: linkError } = await supabaseClient.auth.admin.generateLink({
      type: "recovery",
      email: normalizedEmail,
      options: {
        redirectTo: `${BASE_URL}/dashboard/settings`,
      },
    });

    if (linkError) {
      console.error("Error generating recovery link:", linkError);
      // Don't reveal if user doesn't exist
      return new Response(
        JSON.stringify({ success: true, message: "If an account exists, a reset link has been sent." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Use the official action_link from Supabase which contains the proper hashed_token
    let recoveryUrl = linkData?.properties?.action_link;
    
    if (recoveryUrl) {
      // Replace the default redirect in action_link to point to our settings page with recovery flag
      try {
        const url = new URL(recoveryUrl);
        url.searchParams.set("redirect_to", `${BASE_URL}/dashboard/settings?recovery=true`);
        recoveryUrl = url.toString();
      } catch {
        // If URL parsing fails, use action_link as-is
        console.log("Could not parse action_link URL, using as-is");
      }
    } else {
      // Fallback: if action_link is not available, build a basic one
      console.warn("action_link not available from generateLink, using fallback");
      recoveryUrl = `${SUPABASE_URL}/auth/v1/verify?type=recovery&token=${linkData?.properties?.hashed_token}&redirect_to=${encodeURIComponent(`${BASE_URL}/dashboard/settings?recovery=true`)}`;
    }

    // Look up name for personalization
    const { data: profile } = await supabaseClient
      .from("profiles")
      .select("full_name")
      .eq("email", normalizedEmail)
      .maybeSingle();

    const firstName = profile?.full_name?.split(" ")[0] || "there";

    await resend.emails.send({
      from: "APEX Financial <notifications@apex-financial.org>",
      to: [normalizedEmail],
      subject: "Reset Your Password – APEX",
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 20px;">
          <div style="text-align: center; margin-bottom: 24px;">
            <h1 style="font-size: 24px; font-weight: 700; color: #1a1a2e; margin: 0;">APEX Financial</h1>
          </div>
          <p style="font-size: 16px; color: #333; margin-bottom: 16px;">Hey ${firstName},</p>
          <p style="font-size: 14px; color: #555; margin-bottom: 24px;">We received a request to reset your password. Click the button below to set a new password:</p>
          <div style="text-align: center; margin-bottom: 24px;">
            <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 auto;">
              <tr>
                <td align="center" bgcolor="#7c3aed" style="border-radius:8px;">
                  <a href="${recoveryUrl}" style="display:inline-block;color:#ffffff;padding:14px 32px;text-decoration:none;font-weight:600;font-size:16px;">
                    Reset Password
                  </a>
                </td>
              </tr>
            </table>
          </div>
          <p style="font-size: 12px; color: #999; text-align: center;">If you didn't request this, you can safely ignore this email.</p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
          <p style="font-size: 11px; color: #aaa; text-align: center;">Powered by Apex Financial</p>
        </div>
      `,
    });

    console.log("Password reset email sent to:", normalizedEmail);
    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Error in send-password-reset:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
};

serve(handler);
