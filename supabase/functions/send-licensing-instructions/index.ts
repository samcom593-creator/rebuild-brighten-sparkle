import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "npm:resend@2.0.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { logFunctionError, writeAudit } from "../_shared/audit.ts";
import { SCHEDULING_LINKS } from "../_shared/apex.ts";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));
const ADMIN_EMAIL = "info@kingofsales.net";
const SLACK_LINK = "https://join.slack.com/t/apex-financial-co/shared_invite/zt-47rdeq1fr-ETmj8yGBgRcoYVkwfc3DBQ";
const DISCORD_LINK = "https://discord.gg/JpUWA73UZX";
const PORTAL_LINK = "https://apex-financial.org/agent-portal";
const CONTRACTING_LINK = "https://apex-financial.org/start-contracting";
const TRAINING_LINK = "https://apex-financial.org/dashboard/training/library";
const PRELICENSING_LINK = "https://partners.xcelsolutions.com/afe";

interface LicensingEmailRequest {
  email: string;
  firstName: string;
  licenseStatus: "licensed" | "unlicensed" | "pending";
  managerEmail?: string;
  phone?: string;
  agentId?: string;
}

function buildStepCard(
  stepNumber: string,
  stepTitle: string,
  description: string,
  linkUrl: string,
  buttonText: string,
  accentColor: string,
  accentRgb: string,
): string {
  return `
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background: rgba(${accentRgb}, 0.1); border: 1px solid rgba(${accentRgb}, 0.3); border-radius: 12px; margin-bottom: 15px;">
    <tr>
      <td style="padding: 20px;">
        <table role="presentation" cellspacing="0" cellpadding="0" style="margin-bottom: 10px;">
          <tr>
            <td width="36" valign="middle" style="padding-right: 12px;">
              <table role="presentation" cellspacing="0" cellpadding="0" width="28" height="28">
                <tr>
                  <td align="center" valign="middle" style="background: ${accentColor}; color: white; width: 28px; height: 28px; border-radius: 50%; font-weight: bold; font-size: 14px;">
                    ${stepNumber}
                  </td>
                </tr>
              </table>
            </td>
            <td valign="middle">
              <span style="color: ${accentColor.includes('gradient') ? accentRgb.includes('240') ? '#f093fb' : accentRgb.includes('102') ? '#667eea' : '#4CAF50' : accentColor}; font-size: 16px; font-weight: 600;">${stepTitle}</span>
            </td>
          </tr>
        </table>
        <p style="color: #e0e0e0; font-size: 14px; line-height: 1.6; margin: 0 0 16px;">
          ${description}
        </p>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
          <tr>
            <td align="center" bgcolor="${accentColor}" style="background-color: ${accentColor}; border-radius: 8px;">
              <a href="${linkUrl}" style="display: inline-block; width: 100%; color: #ffffff; text-decoration: none; padding: 14px 24px; font-size: 16px; font-weight: 600; text-align: center; box-sizing: border-box; word-break: break-word; mso-padding-alt: 0;" target="_blank">
                <!--[if mso]><i style="mso-font-width:300%;mso-text-raise:30pt">&nbsp;</i><![endif]-->
                <span style="mso-text-raise:15pt;">${buttonText}</span>
                <!--[if mso]><i style="mso-font-width:300%">&nbsp;</i><![endif]-->
              </a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>`;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { email, firstName, licenseStatus, managerEmail, phone, agentId }: LicensingEmailRequest = await req.json();

    console.log(`[send-licensing-instructions] Sending to ${email}, status: ${licenseStatus}, agentId: ${agentId}`);

    if (!email || !firstName) {
      throw new Error("Missing required fields: email and firstName");
    }

    // Resolve manager email from DB if not provided directly
    let resolvedManagerEmail = managerEmail;
    if (!resolvedManagerEmail && agentId) {
      try {
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        // Look up the assigned agent's manager email via profiles
        const { data: agentData } = await supabase
          .from("agents")
          .select("manager_id, profiles!agents_profile_id_fkey(email)")
          .eq("id", agentId)
          .single();

        if (agentData?.manager_id) {
          const { data: managerData } = await supabase
            .from("agents")
            .select("profiles!agents_profile_id_fkey(email)")
            .eq("id", agentData.manager_id)
            .single();

          resolvedManagerEmail = (managerData as any)?.profiles?.email;
          console.log(`[send-licensing-instructions] Resolved manager email: ${resolvedManagerEmail}`);
        }
      } catch (e) {
        console.error("[send-licensing-instructions] Could not resolve manager email:", e);
      }
    }

    const ccList = [ADMIN_EMAIL, resolvedManagerEmail]
      .filter(Boolean)
      .filter((v, i, a) => a.indexOf(v) === i) as string[];

    let subject: string;
    let htmlContent: string;

    if (licenseStatus === "licensed") {
      subject = "🎉 Welcome to Apex Financial – Let's Get Started!";
      htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #0a0a0a; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; word-break: break-word;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #0a0a0a;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 600px; background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); border-radius: 16px; overflow: hidden;">
          <tr>
            <td style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 700;">
                🎉 Welcome to Apex Financial!
              </h1>
            </td>
          </tr>
          <tr>
            <td style="padding: 40px 30px;">
              <p style="color: #ffffff; font-size: 18px; line-height: 1.6; margin: 0 0 20px;">
                Hey ${firstName}! 👋
              </p>
              <p style="color: #e0e0e0; font-size: 16px; line-height: 1.6; margin: 0 0 25px;">
                Since you're already licensed, follow this roadmap in order. Slack is the primary team hub and Discord gives you direct community and contracting support.
              </p>
              ${buildStepCard("1", "Join the APEX Slack", "Join the primary team workspace for daily huddles, support, training, scripts, and sales wins.", SLACK_LINK, "Join Team Slack →", "#D4AF37", "212, 175, 55")}
              ${buildStepCard("2", "Join the APEX Discord", "Join the community and contracting-support workspace so you never lose the next handoff.", DISCORD_LINK, "Join Team Discord →", "#5865F2", "88, 101, 242")}
              ${buildStepCard("3", "Book Your Onboarding Call", "Meet with Milver, your Contracting &amp; Onboarding Manager, to lock in your first-week plan.", SCHEDULING_LINKS.licensed, "Book My Call →", "#667eea", "102, 126, 234")}
              ${buildStepCard("4", "Set Up Your APEX Account", "Open the portal, sign in with your email, confirm your profile, and use the live roadmap as your source of truth.", PORTAL_LINK, "Open My Account &amp; Roadmap →", "#14b8a6", "20, 184, 166")}
              ${buildStepCard("5", "Complete APEX Contracting", "Submit your NPN and profile once. APEX routes the intake to the private contracting desk automatically.", CONTRACTING_LINK, "Complete Contracting →", "#f59e0b", "245, 158, 11")}
              ${buildStepCard("6", "Finish Online Training", "Complete onboarding, scripts, objections, ReadyMode, pipeline, deal-posting, and underwriting training before launch.", TRAINING_LINK, "Start Training →", "#4CAF50", "76, 175, 80")}
            </td>
          </tr>
          <tr>
            <td style="background: rgba(0,0,0,0.3); padding: 25px 30px; text-align: center; border-top: 1px solid rgba(255,255,255,0.1);">
              <p style="color: #888; font-size: 14px; margin: 0;">
                Powered by <strong style="color: #667eea;">Apex Financial</strong>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
    } else {
      subject = "🚀 Your Licensing Resources – Let's Get You Started!";
      htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #0a0a0a; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; word-break: break-word;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #0a0a0a;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 600px; background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); border-radius: 16px; overflow: hidden;">
          <tr>
            <td style="background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); padding: 30px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 700;">
                🚀 Your Path to Getting Licensed
              </h1>
            </td>
          </tr>
          <tr>
            <td style="padding: 40px 30px;">
              <p style="color: #ffffff; font-size: 18px; line-height: 1.6; margin: 0 0 20px;">
                Hey ${firstName}! 👋
              </p>
              <p style="color: #e0e0e0; font-size: 16px; line-height: 1.6; margin: 0 0 25px;">
                Follow this roadmap in order. Your licensing course is the training priority, your APEX account tracks progress, and Slack is where the team supports you.
              </p>

              ${buildStepCard(
                "1",
                "Join the APEX Slack",
                "Join the primary team workspace for licensing support, questions, updates, and training.",
                SLACK_LINK,
                "Join Team Slack →",
                "#D4AF37",
                "212, 175, 55",
              )}

              ${buildStepCard(
                "2",
                "Join the APEX Discord",
                "Join the community and licensing-support workspace so you always know who to ask and what comes next.",
                DISCORD_LINK,
                "Join Team Discord →",
                "#5865F2",
                "88, 101, 242",
              )}

              ${buildStepCard(
                "3",
                "Set Up Your Course Account",
                "Create your XCEL account with the same legal name shown on your ID, then begin the pre-licensing course.",
                PRELICENSING_LINK,
                "📚 Create Account &amp; Start Course",
                "#667eea",
                "102, 126, 234",
              )}

              ${buildStepCard(
                "4",
                "Learn the Licensing Process",
                "Watch the overview, then work the course modules in order until you are ready for the state exam.",
                "https://apex-financial.org/get-licensed#licensing-video",
                "🎬 How to Get Your Life Insurance License",
                "#4CAF50",
                "76, 175, 80",
              )}

              ${buildStepCard(
                "5",
                "Open Your APEX Roadmap",
                "Sign in to your APEX account and update course, exam, fingerprints, and license milestones as they happen.",
                "https://apex-financial.org/get-licensed",
                "Open My Licensing Roadmap →",
                "#14b8a6",
                "20, 184, 166",
              )}

              ${buildStepCard(
                "6",
                "Pass, Add Your NPN, Then Onboard",
                "After your license posts, add your NPN in APEX and book the onboarding call. Contracting and sales training unlock next.",
                SCHEDULING_LINKS.licensed,
                "Book Licensed Onboarding →",
                "#f093fb",
                "240, 147, 251",
              )}

              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background: rgba(255,255,255,0.05); border-radius: 12px; margin: 25px 0;">
                <tr>
                  <td style="padding: 25px;">
                    <p style="color: #ffffff; font-size: 16px; font-weight: 600; margin: 0 0 15px;">
                      💡 Good to know:
                    </p>
                    <ul style="color: #e0e0e0; font-size: 15px; line-height: 1.8; margin: 0; padding-left: 20px;">
                      <li>✅ <strong>We cover licensing costs</strong> – no upfront payment</li>
                      <li>✅ Takes about <strong>7 days</strong> to complete</li>
                      <li>✅ <strong>Full support</strong> from our team</li>
                      <li>✅ Start at <strong>70% commission</strong> (up to 145%)</li>
                    </ul>
                  </td>
                </tr>
              </table>

              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center" style="padding: 20px 0;">
                    <table role="presentation" cellspacing="0" cellpadding="0" width="100%">
                      <tr>
                        <td align="center" bgcolor="#f093fb" style="background-color: #f093fb; border-radius: 8px;">
                          <a href="${SCHEDULING_LINKS.unlicensed}" 
                             style="display: inline-block; width: 100%; color: #ffffff; text-decoration: none; padding: 16px 32px; font-size: 18px; font-weight: 600; text-align: center; box-sizing: border-box;" target="_blank">
                            📞 Need Help? Schedule a Call
                          </a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="background: rgba(0,0,0,0.3); padding: 25px 30px; text-align: center; border-top: 1px solid rgba(255,255,255,0.1);">
              <p style="color: #888; font-size: 14px; margin: 0;">
                Powered by <strong style="color: #f093fb;">Apex Financial</strong>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
    }

    const emailResponse = await resend.emails.send({
      from: "APEX Financial <notifications@apex-financial.org>",
      to: [email],
      cc: ccList.length > 0 ? ccList : undefined,
      subject: subject,
      html: htmlContent,
    });

    console.log(`[send-licensing-instructions] Email sent successfully, CC: ${ccList.join(", ")}:`, emailResponse);

    const channels: { email: boolean; push?: boolean; sms?: boolean } = { email: true };
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Send push notification if applicant has an account
    try {
      const pushMsg = licenseStatus === "licensed"
        ? `Hey ${firstName}! Schedule your onboarding call to get started 🚀`
        : `Hey ${firstName}! Your licensing resources are ready – check your email 📚`;

      const pushRes = await fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${supabaseServiceKey}` },
        body: JSON.stringify({ email, title: "Apex Financial – Licensing", body: pushMsg }),
      });
      channels.push = pushRes.ok;
      console.log(`[send-licensing-instructions] Push: ${pushRes.ok}`);
    } catch (e) {
      channels.push = false;
      console.error("[send-licensing-instructions] Push failed:", e);
    }

    // Send SMS if phone provided
    if (phone) {
      try {
        const smsMsg = licenseStatus === "licensed"
          ? `Hey ${firstName}, welcome to APEX. Your 5-step roadmap is in your email. Start by joining Slack: ${SLACK_LINK}`
          : `Hey ${firstName}, your licensing roadmap is in your email. Create your XCEL course account here: ${PRELICENSING_LINK}`;

        const smsRes = await fetch(`${supabaseUrl}/functions/v1/send-sms-auto-detect`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${supabaseServiceKey}` },
          body: JSON.stringify({ phone, message: smsMsg }),
        });
        // MP-417: `.ok` is HTTP transport, not delivery. A 200 carrying
        // outcome:"skipped" means no carrier was on file and nothing was sent —
        // and `channels` is written into the audit log below, so that recorded a
        // delivery that never happened.
        const smsJson = await smsRes.json().catch(() => ({} as Record<string, unknown>));
        const smsOutcome = (smsJson as { outcome?: string }).outcome;
        channels.sms = smsRes.ok && smsOutcome === "sent";
        console.log(`[send-licensing-instructions] SMS: ${channels.sms} (outcome=${smsOutcome ?? `http ${smsRes.status}`})`);
      } catch (e) {
        channels.sms = false;
        console.error("[send-licensing-instructions] SMS failed:", e);
      }
    }

    try {
      const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      await writeAudit(sb as any, {
        action: "licensing.instructions_sent",
        entityType: "agent",
        entityId: agentId ?? email,
        afterData: { licenseStatus, channels, ccList },
      });
    } catch (_) { /* swallow */ }

    return new Response(JSON.stringify({ success: true, data: emailResponse, channels }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error: any) {
    console.error("[send-licensing-instructions] Error:", error);
    try {
      const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      await logFunctionError(sb as any, "send-licensing-instructions", error);
    } catch (_) { /* swallow */ }
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
};

serve(handler);
