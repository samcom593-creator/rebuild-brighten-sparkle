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
const ADMIN_EMAIL = "info@apex-financial.org";

async function generateMagicToken(
  supabaseClient: any,
  agentId: string,
  email: string,
  destination: string
): Promise<string> {
  const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');

  await supabaseClient.from("magic_login_tokens").insert({
    agent_id: agentId,
    email: email.toLowerCase().trim(),
    token,
    destination,
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  });

  return `${BASE_URL}/magic-login?token=${token}`;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { agentId }: { agentId: string } = await req.json();

    if (!agentId) {
      return new Response(
        JSON.stringify({ error: "Missing agentId" }),
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
      .select("user_id, invited_by_manager_id")
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

    // Look up manager email for CC
    let managerEmail: string | null = null;
    if (agent.invited_by_manager_id) {
      const { data: managerAgent } = await supabaseClient
        .from("agents")
        .select("profile_id")
        .eq("id", agent.invited_by_manager_id)
        .single();

      if (managerAgent?.profile_id) {
        const { data: managerProfile } = await supabaseClient
          .from("profiles")
          .select("email")
          .eq("id", managerAgent.profile_id)
          .single();
        managerEmail = managerProfile?.email || null;
      }
    }

    const ccList = [ADMIN_EMAIL, managerEmail]
      .filter(Boolean)
      .filter((v, i, a) => a.indexOf(v) === i) as string[];

    const firstName = profile.full_name?.split(" ")[0] || "Agent";

    // Generate magic link with "course" destination
    const courseMagicLink = await generateMagicToken(supabaseClient, agentId, profile.email, "course");

    // Create tracking record
    const { data: trackingRecord } = await supabaseClient
      .from("email_tracking")
      .insert({
        agent_id: agentId,
        email_type: "course_enrollment",
        recipient_email: profile.email,
        metadata: {
          agent_name: profile.full_name,
          magic_link: true,
        }
      })
      .select("id")
      .single();

    const trackingPixelUrl = trackingRecord
      ? `${SUPABASE_URL}/functions/v1/track-email-open?id=${trackingRecord.id}`
      : "";

    try {
      await resend.emails.send({
        from: "APEX Financial <noreply@apex-financial.org>",
        to: [profile.email],
        cc: ccList.length > 0 ? ccList : undefined,
        subject: "🎓 Your APEX Training Course Is Ready!",
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
          </head>
          <body style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; padding: 0; background-color: #0a0f1a;">
            <div style="width: 100%; max-width: 600px; margin: 0 auto; padding: 40px 20px; word-break: break-word;">
              <div style="background: linear-gradient(135deg, #0d1526 0%, #1a2a4a 100%); border-radius: 16px; padding: 40px; border: 1px solid rgba(20, 184, 166, 0.3);">
                
                <div style="text-align: center; margin-bottom: 24px;">
                  <span style="font-size: 64px;">🎓</span>
                </div>
                
                <h1 style="color: #14b8a6; font-size: 28px; margin: 0 0 16px 0; text-align: center;">
                  Hey ${firstName}!
                </h1>
                
                <h2 style="color: #ffffff; font-size: 22px; margin: 0 0 24px 0; text-align: center;">
                  Your Training Course Is Ready
                </h2>
                
                <p style="color: #e2e8f0; font-size: 16px; line-height: 1.8; margin: 0 0 24px 0;">
                  You've been enrolled in the APEX onboarding course. Tap the button below to jump right in — no password needed!
                </p>
                
                <div style="background: rgba(20, 184, 166, 0.1); border-radius: 12px; padding: 24px; margin: 24px 0;">
                  <h3 style="color: #14b8a6; font-size: 18px; margin: 0 0 16px 0;">What to Expect</h3>
                  <ul style="color: #e2e8f0; font-size: 14px; line-height: 2.2; margin: 0; padding-left: 20px;">
                    <li>Short video modules you can watch at your own pace</li>
                    <li>Quick quizzes after each module</li>
                    <li>Track your progress as you go</li>
                    <li>Complete when you're ready — no rush!</li>
                  </ul>
                </div>
                
                <div style="text-align: center; margin: 32px 0;">
                  <a href="${courseMagicLink}" style="display: inline-block; background: linear-gradient(135deg, #14b8a6 0%, #0d9488 100%); color: #0a0f1a; text-decoration: none; padding: 18px 48px; max-width: 100%; box-sizing: border-box; border-radius: 8px; font-weight: bold; font-size: 18px;">
                    🎓 Start My Course →
                  </a>
                </div>
                
                <p style="color: #64748b; font-size: 12px; text-align: center; margin: 0 0 24px 0;">
                  One-tap access • No password needed
                </p>

                <div style="background: rgba(88, 101, 242, 0.1); border-radius: 12px; padding: 20px; margin: 24px 0; text-align: center;">
                  <p style="color: #5865F2; font-size: 14px; font-weight: bold; margin: 0 0 8px 0;">
                    💬 Need Help? Join Our Discord
                  </p>
                  <p style="color: #94a3b8; font-size: 13px; margin: 0 0 12px 0;">
                    Get support and connect with the team:
                  </p>
                  <a href="https://discord.gg/JpUWA73UZX" style="display: inline-block; background: #5865F2; color: #ffffff; text-decoration: none; padding: 10px 24px; border-radius: 6px; font-weight: bold; font-size: 14px;">
                    Join Discord →
                  </a>
                </div>

                <div style="background: rgba(148, 163, 184, 0.1); border-radius: 8px; padding: 16px; margin: 24px 0;">
                  <p style="color: #94a3b8; font-size: 12px; margin: 0; text-align: center;">
                    Button not working? Sign in at <a href="${BASE_URL}/agent-login" style="color: #14b8a6;">apex-financial.org/agent-login</a><br>
                    using your email: <strong style="color: #e2e8f0;">${profile.email}</strong>
                  </p>
                </div>
                
                <div style="border-top: 1px solid rgba(148, 163, 184, 0.2); padding-top: 24px; margin-top: 32px;">
                  <p style="color: #64748b; font-size: 12px; margin: 0; text-align: center;">
                    Powered by APEX Financial
                  </p>
                </div>
                
                ${trackingPixelUrl ? `<img src="${trackingPixelUrl}" width="1" height="1" style="display:none;" alt="" />` : ""}
              </div>
            </div>
          </body>
          </html>
        `,
      });

      console.log(`Course enrollment email sent to ${profile.email}, CC: ${ccList.join(", ")}`);

      return new Response(
        JSON.stringify({ success: true, message: `Course enrollment email sent to ${profile.email}` }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } catch (emailError: any) {
      console.error("Failed to send course enrollment email:", emailError);
      return new Response(
        JSON.stringify({ success: false, error: emailError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  } catch (error: any) {
    console.error("Error in send-course-enrollment-email:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
};

serve(handler);
