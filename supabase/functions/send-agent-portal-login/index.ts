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
const ADMIN_EMAIL = "info@kingofsales.net";

// Generate magic link token
async function generateMagicToken(
  supabaseClient: any,
  agentId: string,
  email: string,
  destination: "portal" | "numbers"
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

interface SendLoginRequest {
  agentId: string;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      SUPABASE_URL,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // MP-451: this endpoint mints a 24h magic_login_tokens row for a
    // caller-named agent and mails it, acting with the service-role key.
    // config.toml sets verify_jwt = false, so before this gate a bare
    // unauthenticated POST reached the handler. Proven live pre-fix: an absent
    // Authorization header with a nonexistent agentId returned this function's
    // OWN 404 "Agent not found" (its body validation, so the handler ran) while
    // gated siblings generate-magic-link and create-agent-from-leaderboard
    // returned 401 to the identical credential-less request.
    //
    // STAFF, not admin-only, and that is measured rather than assumed:
    // /recruit-pipeline and /dashboard/team are ProtectedRoute WITHOUT
    // requireAdmin and AgentPipeline branches on (isManager || isAdmin), so the
    // 9 managers legitimately send a recruit their login link. Gating this to
    // the 2 admins would break real recruiting work. The 509 plain agents are
    // the population this refuses.
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const { data: authData, error: authError } = await supabaseClient.auth.getUser(
      authHeader.slice(7)
    );
    if (authError || !authData?.user?.id) {
      // The anon key that ships in the browser bundle lands here: it is a valid
      // apikey but carries no user, so getUser returns none and this refuses.
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const { data: callerRoles, error: roleError } = await supabaseClient
      .from("user_roles")
      .select("role")
      .eq("user_id", authData.user.id);
    // Unknown coerces toward refusal — a failed role read must never read as
    // "is staff" (MP-447).
    const SEND_LOGIN_STAFF_ROLES = new Set(["admin", "manager"]);
    if (
      roleError ||
      !(callerRoles ?? []).some((r: { role: unknown }) =>
        SEND_LOGIN_STAFF_ROLES.has(String(r.role))
      )
    ) {
      return new Response(
        JSON.stringify({ error: "Staff access required" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { agentId }: SendLoginRequest = await req.json();

    // Get agent details including manager and license_status.
    // license_status gates the Discord CTA in this email (LICENSED ONLY).
    const { data: agent, error: agentError } = await supabaseClient
      .from("agents")
      .select("user_id, onboarding_stage, invited_by_manager_id, license_status, display_name")
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

    // MP-340: a dead address on the CC line suppresses the WHOLE message.
    // info@kingofsales.net has been on Resend's suppression list since
    // 2026-07-27 (origin: bounce, and a fresh probe hard-bounced again — the
    // mailbox does not exist even though the domain has valid Google MX
    // records). Because this email CC'd it, Kayla Maiten's login link was
    // recorded "sent" by this function and then SUPPRESSED by the provider:
    // she never received it and nothing here noticed. Her own address delivers
    // fine, proven with a direct probe.
    //
    // The agent is the recipient that matters, so a courtesy copy must never be
    // able to block their mail. UNDELIVERABLE_CC is the known-dead list; the
    // real fix is pointing ADMIN_EMAIL at an address Sam actually reads
    // (info@kingofsales.net and sam.com593@gmail.com both deliver), which is
    // his call to make, not a guess to bake into 91 functions.
    const UNDELIVERABLE_CC = new Set(["info@kingofsales.net"]);
    const ccList = [ADMIN_EMAIL, managerEmail]
      .filter(Boolean)
      .filter((v) => !UNDELIVERABLE_CC.has(String(v).toLowerCase()))
      .filter((v, i, a) => a.indexOf(v) === i) as string[];

    // Never greet a person with their own email address. profiles.full_name is
    // set to the raw email on 411 rows (2 of them active agents), so reading it
    // alone sent Kayla Maiten an email opening "Hey maitenkayla@gmail.com" —
    // her agents.display_name said "Kayla Maiten" the whole time. Prefer the
    // agent row, fall back to the profile, and reject anything that still looks
    // like an address rather than pasting it into a greeting.
    const nameCandidates = [agent?.display_name, profile.full_name]
      .map((v) => (typeof v === "string" ? v.trim() : ""))
      .filter((v) => v.length > 0 && !v.includes("@"));
    const firstName = nameCandidates[0]?.split(/\s+/)[0] || "Agent";

    // Discord invite gate: license_status MUST equal 'licensed' before we can
    // include the Discord CTA in ANY outbound email. Matches the guard in
    // send-agent-onboarding-email (email_kind='discord' → licensed only).
    const licenseStatus = (agent?.license_status ?? "").toString().toLowerCase();
    const isLicensed = licenseStatus === "licensed";

    // Generate magic links
    const portalMagicLink = await generateMagicToken(supabaseClient, agentId, profile.email, "portal");
    const numbersMagicLink = await generateMagicToken(supabaseClient, agentId, profile.email, "numbers");

    // Create tracking record
    const { data: trackingRecord, error: trackingError } = await supabaseClient
      .from("email_tracking")
      .insert({
        agent_id: agentId,
        email_type: "portal_login",
        recipient_email: profile.email,
        metadata: {
          agent_name: profile.full_name,
          onboarding_stage: agent.onboarding_stage,
          magic_link: true,
        }
      })
      .select("id")
      .single();

    if (trackingError) {
      console.error("Failed to create tracking record:", trackingError);
    }

    const trackingPixelUrl = trackingRecord 
      ? `${SUPABASE_URL}/functions/v1/track-email-open?id=${trackingRecord.id}`
      : "";

    try {
      // 2026-07-30: this discarded Resend's return value. The Resend SDK v2 does NOT
      // throw on API errors — it resolves with { data, error } — so the try/catch below
      // never fired and the function returned success:true for sends that never left the
      // building. With the provider account currently under review and rejecting every
      // external recipient, this reported 100% delivery while delivering nothing.
      const { data: sendData, error: sendError } = await resend.emails.send({
        from: "APEX Financial <notifications@apex-financial.org>",
        to: [profile.email],
        cc: ccList.length > 0 ? ccList : undefined,
        subject: "🎉 Welcome to the Agent Portal - One-Tap Access Inside!",
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
                  You've officially made it through training and are now a live agent. Just tap the button below to access your portal - no password needed!
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
                  <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 auto;">
                    <tr>
                      <td align="center" bgcolor="#14b8a6" style="border-radius:8px;">
                        <a href="${portalMagicLink}" style="display:inline-block;color:#0a0f1a;text-decoration:none;padding:18px 48px;font-weight:bold;font-size:18px;">
                          🚀 Open My Portal →
                        </a>
                      </td>
                    </tr>
                  </table>
                </div>
                
                <p style="color: #64748b; font-size: 12px; text-align: center; margin: 0 0 24px 0;">
                  One-tap login • No password needed
                </p>

                <div style="background: rgba(245, 158, 11, 0.1); border-radius: 12px; padding: 20px; margin: 24px 0; text-align: center;">
                  <p style="color: #f59e0b; font-size: 14px; font-weight: bold; margin: 0 0 8px 0;">
                    ⚡ Quick Access
                  </p>
                  <p style="color: #94a3b8; font-size: 13px; margin: 0 0 12px 0;">
                    Need to log your numbers quickly?
                  </p>
                  <a href="${numbersMagicLink}" style="display: inline-block; background: rgba(245, 158, 11, 0.2); color: #f59e0b; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-weight: bold; font-size: 14px; border: 1px solid rgba(245, 158, 11, 0.3);">
                    📊 Log Numbers Now →
                  </a>
                </div>
                
                <div style="background: rgba(245, 158, 11, 0.1); border-left: 4px solid #f59e0b; padding: 16px; margin: 24px 0; border-radius: 0 12px 12px 0;">
                  <p style="color: #f59e0b; font-size: 14px; font-weight: bold; margin: 0 0 4px 0;">
                    Daily Expectation
                  </p>
                  <p style="color: #94a3b8; font-size: 14px; margin: 0;">
                    Log your numbers every day by 7 PM to stay on track!
                  </p>
                </div>

                ${isLicensed ? `
                <div style="background: rgba(88, 101, 242, 0.1); border-radius: 12px; padding: 20px; margin: 24px 0; text-align: center;">
                  <p style="color: #5865F2; font-size: 14px; font-weight: bold; margin: 0 0 8px 0;">
                    💬 Join Our Team Discord
                  </p>
                  <p style="color: #94a3b8; font-size: 13px; margin: 0 0 12px 0;">
                    Get daily training, support, and connect with the team:
                  </p>
                  <a href="https://discord.gg/JpUWA73UZX" style="display: inline-block; background: #5865F2; color: #ffffff; text-decoration: none; padding: 10px 24px; border-radius: 6px; font-weight: bold; font-size: 14px;">
                    Join Discord →
                  </a>
                </div>
                ` : ''}

                <div style="background: rgba(148, 163, 184, 0.1); border-radius: 8px; padding: 16px; margin: 24px 0;">
                  <p style="color: #94a3b8; font-size: 12px; margin: 0; text-align: center;">
                    Link not working? You can also sign in at <a href="${BASE_URL}/agent-login" style="color: #14b8a6;">apex-financial.org/agent-login</a><br>
                    using your email: <strong style="color: #e2e8f0;">${profile.email}</strong>
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

      if (sendError) {
        const msg = typeof sendError === "string" ? sendError : JSON.stringify(sendError);
        console.error("Resend rejected portal login email:", msg);
        return new Response(
          JSON.stringify({ success: false, error: `resend: ${msg.slice(0, 300)}` }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      // A 2xx with no id is not a send either — same guard the outreach-sender uses.
      if (!sendData?.id) {
        console.error("Resend returned 2xx with no message id");
        return new Response(
          JSON.stringify({ success: false, error: "resend returned no message id" }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      await supabaseClient
        .from("agents")
        .update({ portal_password_set: false })
        .eq("id", agentId);

      console.log(`Magic link portal login email sent to ${profile.email}, CC: ${ccList.join(", ")}, tracking ID: ${trackingRecord?.id || 'none'}`);

      return new Response(
        JSON.stringify({ 
          success: true, 
          message: `Portal login with magic link sent to ${profile.email}`,
          trackingId: trackingRecord?.id
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
