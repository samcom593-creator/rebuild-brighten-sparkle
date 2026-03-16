import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "npm:resend@2.0.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));
const ADMIN_EMAIL = "sam@apex-financial.org";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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
            <td align="center">
              <a href="${linkUrl}" style="display: block; background: ${accentColor}; color: #ffffff; text-decoration: none; padding: 14px 24px; border-radius: 8px; font-size: 16px; font-weight: 600; text-align: center; max-width: 100%; box-sizing: border-box; word-break: break-word;" target="_blank">
                ${buttonText}
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
    const { email, firstName, licenseStatus, managerEmail, phone }: LicensingEmailRequest = await req.json();
    const whatsappLink = Deno.env.get("WHATSAPP_GROUP_LINK") || "";

    console.log(`[send-licensing-instructions] Sending to ${email}, status: ${licenseStatus}`);

    if (!email || !firstName) {
      throw new Error("Missing required fields: email and firstName");
    }

    const ccList = [ADMIN_EMAIL, managerEmail]
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
                Since you're already licensed, you're ready to hit the ground running! Here's your next step:
              </p>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center" style="padding: 20px 0;">
                    <a href="https://calendly.com/apexfinancialmarketing/apex-financial-onboarding" 
                       style="display: block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: #ffffff; text-decoration: none; padding: 16px 32px; border-radius: 8px; font-size: 18px; font-weight: 600; text-align: center; max-width: 100%; box-sizing: border-box;" target="_blank">
                      📅 Schedule Your Onboarding Call
                    </a>
                  </td>
                </tr>
              </table>
              <p style="color: #e0e0e0; font-size: 16px; line-height: 1.6; margin: 25px 0;">
                On your call, we'll get you set up with:
              </p>
              <ul style="color: #e0e0e0; font-size: 16px; line-height: 1.8; margin: 0 0 25px; padding-left: 20px;">
                <li>✅ Agent portal access &amp; training</li>
                <li>✅ Unlimited warm leads to start calling</li>
                <li>✅ Your personalized compensation structure</li>
                <li>✅ Everything you need to close your first deal</li>
              </ul>
              ${whatsappLink ? `
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background: rgba(37,211,102,0.1); border: 1px solid rgba(37,211,102,0.3); border-radius: 12px; margin: 20px 0;">
                <tr>
                  <td style="padding: 20px; text-align: center;">
                    <p style="color: #25D366; font-weight: bold; font-size: 14px; margin: 0 0 8px;">💬 Join Our WhatsApp Group</p>
                    <p style="color: #e0e0e0; font-size: 13px; margin: 0 0 12px;">Connect with the team and get real-time support.</p>
                    <a href="${whatsappLink}" style="display: inline-block; background: #25D366; color: #ffffff; text-decoration: none; padding: 10px 24px; border-radius: 8px; font-weight: bold; font-size: 14px;">Join WhatsApp →</a>
                  </td>
                </tr>
              </table>
              ` : ''}

              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background: rgba(102, 126, 234, 0.1); border: 1px solid rgba(102, 126, 234, 0.3); border-radius: 12px;">
                <tr>
                  <td style="padding: 20px;">
                    <p style="color: #667eea; font-size: 14px; font-weight: 600; margin: 0 0 10px;">
                      🎬 While you wait, watch this:
                    </p>
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                      <tr>
                        <td align="center">
                          <a href="https://www.youtube.com/watch?v=fKKaodfYPnk" style="display: block; background: #667eea; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-size: 16px; font-weight: 600; text-align: center; max-width: 100%; box-sizing: border-box;" target="_blank">
                            🎬 Watch Agent Success Testimonials
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
                Here are the resources you need to get your life insurance license and start earning with Apex Financial:
              </p>

              ${buildStepCard(
                "1",
                "Watch This Video First",
                "Learn exactly how the licensing process works (10 min):",
                "https://youtu.be/i1e5p-GEfAU",
                "🎬 Watch Licensing Overview",
                "#f093fb",
                "240, 147, 251",
              )}

              ${buildStepCard(
                "2",
                "Read the Step-by-Step Guide",
                "Complete instructions for your state:",
                "https://docs.google.com/document/d/1WBN_bh7Tl6IkhdXwQvrUa6Q58xmV9As_q048aKAeyNg",
                "📄 Open Licensing Guide",
                "#667eea",
                "102, 126, 234",
              )}

              ${buildStepCard(
                "3",
                "Start the Pre-Licensing Course",
                "Get started on your course today:",
                "https://partners.xcelsolutions.com/afe",
                "📚 Start Course Now",
                "#4CAF50",
                "76, 175, 80",
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

              ${whatsappLink ? `
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background: rgba(37,211,102,0.1); border: 1px solid rgba(37,211,102,0.3); border-radius: 12px; margin-bottom: 15px;">
                <tr>
                  <td style="padding: 20px; text-align: center;">
                    <p style="color: #25D366; font-weight: bold; font-size: 14px; margin: 0 0 8px;">💬 Join Our WhatsApp Group</p>
                    <p style="color: #e0e0e0; font-size: 13px; margin: 0 0 12px;">Connect with other recruits and get real-time support.</p>
                    <a href="${whatsappLink}" style="display: inline-block; background: #25D366; color: #ffffff; text-decoration: none; padding: 10px 24px; border-radius: 8px; font-weight: bold; font-size: 14px;">Join WhatsApp →</a>
                  </td>
                </tr>
              </table>
              ` : ''}

              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center" style="padding: 20px 0;">
                    <a href="https://calendly.com/apexfinancialmarketing/apex-interview" 
                       style="display: block; background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); color: #ffffff; text-decoration: none; padding: 16px 32px; border-radius: 8px; font-size: 18px; font-weight: 600; text-align: center; max-width: 100%; box-sizing: border-box;" target="_blank">
                      📞 Need Help? Schedule a Call
                    </a>
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
          ? `Hey ${firstName}, welcome to Apex! Check your email for onboarding steps or schedule here: https://calendly.com/apexfinancialmarketing/apex-financial-onboarding${whatsappLink ? `\n\nJoin our WhatsApp group: ${whatsappLink}` : ''}`
          : `Hey ${firstName}, your licensing resources are in your email! Start here: https://partners.xcelsolutions.com/afe${whatsappLink ? `\n\nJoin our WhatsApp group: ${whatsappLink}` : ''}`;

        const smsRes = await fetch(`${supabaseUrl}/functions/v1/send-sms-auto-detect`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${supabaseServiceKey}` },
          body: JSON.stringify({ phone, message: smsMsg }),
        });
        channels.sms = smsRes.ok;
        console.log(`[send-licensing-instructions] SMS: ${smsRes.ok}`);
      } catch (e) {
        channels.sms = false;
        console.error("[send-licensing-instructions] SMS failed:", e);
      }
    }

    return new Response(JSON.stringify({ success: true, data: emailResponse, channels }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error: any) {
    console.error("[send-licensing-instructions] Error:", error);
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
