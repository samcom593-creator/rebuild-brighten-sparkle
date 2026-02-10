import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "npm:resend@2.0.0";

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
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { email, firstName, licenseStatus, managerEmail }: LicensingEmailRequest = await req.json();

    console.log(`[send-licensing-instructions] Sending to ${email}, status: ${licenseStatus}`);

    if (!email || !firstName) {
      throw new Error("Missing required fields: email and firstName");
    }

    // Build CC list
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
<body style="margin: 0; padding: 0; background-color: #0a0a0a; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #0a0a0a;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); border-radius: 16px; overflow: hidden;">
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
                       style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: #ffffff; text-decoration: none; padding: 16px 40px; border-radius: 8px; font-size: 18px; font-weight: 600;">
                      📅 Schedule Your Onboarding Call
                    </a>
                  </td>
                </tr>
              </table>
              <p style="color: #e0e0e0; font-size: 16px; line-height: 1.6; margin: 25px 0;">
                On your call, we'll get you set up with:
              </p>
              <ul style="color: #e0e0e0; font-size: 16px; line-height: 1.8; margin: 0 0 25px; padding-left: 20px;">
                <li>✅ Agent portal access & training</li>
                <li>✅ Free warm leads to start calling</li>
                <li>✅ Your personalized compensation structure</li>
                <li>✅ Everything you need to close your first deal</li>
              </ul>
              <div style="background: rgba(102, 126, 234, 0.1); border: 1px solid rgba(102, 126, 234, 0.3); border-radius: 12px; padding: 20px; margin: 25px 0;">
                <p style="color: #667eea; font-size: 14px; font-weight: 600; margin: 0 0 10px;">
                  🎬 While you wait, watch this:
                </p>
                <a href="https://www.youtube.com/watch?v=fKKaodfYPnk" style="color: #667eea; font-size: 16px;">
                  Agent Success Testimonials →
                </a>
              </div>
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
</html>
      `;
    } else {
      subject = "🚀 Your Licensing Resources – Let's Get You Started!";
      htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #0a0a0a; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #0a0a0a;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); border-radius: 16px; overflow: hidden;">
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
              <div style="background: rgba(240, 147, 251, 0.1); border: 1px solid rgba(240, 147, 251, 0.3); border-radius: 12px; padding: 20px; margin: 0 0 15px;">
                <div style="display: flex; align-items: center; margin-bottom: 10px;">
                  <span style="background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); color: white; width: 28px; height: 28px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-weight: bold; margin-right: 12px;">1</span>
                  <span style="color: #f093fb; font-size: 16px; font-weight: 600;">Watch This Video First</span>
                </div>
                <p style="color: #e0e0e0; font-size: 14px; line-height: 1.6; margin: 0 0 12px;">
                  Learn exactly how the licensing process works (10 min):
                </p>
                <a href="https://youtu.be/i1e5p-GEfAU" style="color: #f093fb; font-size: 16px; font-weight: 500; text-decoration: none;">
                  🎬 Watch Licensing Overview →
                </a>
              </div>
              <div style="background: rgba(102, 126, 234, 0.1); border: 1px solid rgba(102, 126, 234, 0.3); border-radius: 12px; padding: 20px; margin: 0 0 15px;">
                <div style="display: flex; align-items: center; margin-bottom: 10px;">
                  <span style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; width: 28px; height: 28px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-weight: bold; margin-right: 12px;">2</span>
                  <span style="color: #667eea; font-size: 16px; font-weight: 600;">Read the Step-by-Step Guide</span>
                </div>
                <p style="color: #e0e0e0; font-size: 14px; line-height: 1.6; margin: 0 0 12px;">
                  Complete instructions for your state:
                </p>
                <a href="https://docs.google.com/document/d/1WBN_bh7Tl6IkhdXwQvrUa6Q58xmV9As_q048aKAeyNg" style="color: #667eea; font-size: 16px; font-weight: 500; text-decoration: none;">
                  📄 Open Licensing Guide →
                </a>
              </div>
              <div style="background: rgba(76, 175, 80, 0.1); border: 1px solid rgba(76, 175, 80, 0.3); border-radius: 12px; padding: 20px; margin: 0 0 25px;">
                <div style="display: flex; align-items: center; margin-bottom: 10px;">
                  <span style="background: linear-gradient(135deg, #4CAF50 0%, #45a049 100%); color: white; width: 28px; height: 28px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-weight: bold; margin-right: 12px;">3</span>
                  <span style="color: #4CAF50; font-size: 16px; font-weight: 600;">Start the Pre-Licensing Course</span>
                </div>
                <p style="color: #e0e0e0; font-size: 14px; line-height: 1.6; margin: 0 0 12px;">
                  Get started on your course today:
                </p>
                <a href="https://partners.xcelsolutions.com/afe" style="color: #4CAF50; font-size: 16px; font-weight: 500; text-decoration: none;">
                  📚 Start Course Now →
                </a>
              </div>
              <div style="background: rgba(255,255,255,0.05); border-radius: 12px; padding: 25px; margin: 25px 0;">
                <p style="color: #ffffff; font-size: 16px; font-weight: 600; margin: 0 0 15px;">
                  💡 Good to know:
                </p>
                <ul style="color: #e0e0e0; font-size: 15px; line-height: 1.8; margin: 0; padding-left: 20px;">
                  <li>✅ <strong>We cover licensing costs</strong> – no upfront payment</li>
                  <li>✅ Takes about <strong>7 days</strong> to complete</li>
                  <li>✅ <strong>Full support</strong> from our team</li>
                  <li>✅ Start at <strong>70% commission</strong> (up to 145%)</li>
                </ul>
              </div>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center" style="padding: 20px 0;">
                    <a href="https://calendly.com/apexfinancialmarketing/apex-interview" 
                       style="display: inline-block; background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); color: #ffffff; text-decoration: none; padding: 16px 40px; border-radius: 8px; font-size: 18px; font-weight: 600;">
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
</html>
      `;
    }

    const emailResponse = await resend.emails.send({
      from: "APEX Financial <noreply@apex-financial.org>",
      to: [email],
      cc: ccList.length > 0 ? ccList : undefined,
      subject: subject,
      html: htmlContent,
    });

    console.log(`[send-licensing-instructions] Email sent successfully, CC: ${ccList.join(", ")}:`, emailResponse);

    return new Response(JSON.stringify({ success: true, data: emailResponse }), {
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
