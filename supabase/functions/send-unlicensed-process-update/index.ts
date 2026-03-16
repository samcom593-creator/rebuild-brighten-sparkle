import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));
const APP_URL = "https://rebuild-brighten-sparkle.lovable.app";

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const whatsappLink = body?.whatsappLink || Deno.env.get("WHATSAPP_GROUP_LINK") || "";

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { data: applicants, error } = await supabaseClient
      .from("applications")
      .select("id, first_name, email, license_status, created_at")
      .is("terminated_at", null)
      .neq("license_status", "licensed");

    if (error) throw error;
    if (!applicants?.length) {
      return new Response(JSON.stringify({ success: true, message: "No unlicensed applicants" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let sent = 0;
    const BATCH_SIZE = 10;

    for (let i = 0; i < applicants.length; i += BATCH_SIZE) {
      const batch = applicants.slice(i, i + BATCH_SIZE);
      await Promise.allSettled(
        batch.map(async (app) => {
          if (!app.email) return;
          const checkinUrl = `${APP_URL}/checkin?id=${app.id}`;

          await resend.emails.send({
            from: "APEX Financial Empire <notifications@apex-financial.org>",
            to: [app.email],
            cc: ["sam@apex-financial.org"],
            subject: "🚀 Important Update — New Licensing Support Process",
            html: `
              <!DOCTYPE html>
              <html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
              <body style="font-family: 'Segoe UI', sans-serif; margin: 0; padding: 0; background-color: #0a0f1a;">
                <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
                  <div style="background: linear-gradient(135deg, #0d1526, #1a2a4a); border-radius: 16px; padding: 40px; border: 1px solid rgba(20,184,166,0.3);">
                    <h1 style="color: #14b8a6; font-size: 22px; margin: 0 0 16px;">Hey ${app.first_name}! 🚀</h1>
                    
                    <p style="color: #e2e8f0; font-size: 16px; line-height: 1.6; margin: 0 0 16px;">
                      We're rolling out changes to our hiring process to better support you on your journey to getting licensed. Here's what's new:
                    </p>

                    <div style="background: rgba(20,184,166,0.1); border: 1px solid rgba(20,184,166,0.3); border-radius: 8px; padding: 16px; margin: 0 0 20px;">
                      <p style="color: #14b8a6; font-weight: bold; margin: 0 0 8px;">🎉 LICENSE INCENTIVE</p>
                      <p style="color: #e2e8f0; font-size: 14px; margin: 0;">
                        If you receive your license <strong>within 2 weeks of your application date</strong>, the licensing cost is covered by APEX!
                      </p>
                    </div>

                    <h2 style="color: #e2e8f0; font-size: 16px; margin: 16px 0 8px;">📋 Daily Check-Ins</h2>
                    <p style="color: #94a3b8; font-size: 14px; line-height: 1.6; margin: 0 0 16px;">
                      You'll now receive a daily check-in link. Fill it out every day to report your licensing progress. This takes 30 seconds and helps your manager track and support you.
                    </p>

                    <div style="text-align: center; margin: 24px 0;">
                      <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 auto;">
                        <tr>
                          <td align="center" bgcolor="#14b8a6" style="border-radius:8px;">
                            <a href="${checkinUrl}" style="display:inline-block;color:#0a0f1a;text-decoration:none;padding:14px 36px;font-weight:bold;font-size:15px;">
                              Complete Your First Check-In →
                            </a>
                          </td>
                        </tr>
                      </table>
                    </div>

                    ${whatsappLink ? `
                    <h2 style="color: #e2e8f0; font-size: 16px; margin: 16px 0 8px;">💬 Join Our WhatsApp Group</h2>
                    <p style="color: #94a3b8; font-size: 14px; line-height: 1.6; margin: 0 0 12px;">
                      Connect with other recruits, ask questions, and get real-time support from your managers.
                    </p>
                    <div style="text-align: center; margin: 16px 0;">
                      <a href="${whatsappLink}" style="display: inline-block; background: #25D366; color: white; text-decoration: none; padding: 12px 32px; border-radius: 8px; font-weight: bold; font-size: 14px;">
                        Join WhatsApp Group →
                      </a>
                    </div>
                    ` : ''}

                    <div style="border-top: 1px solid rgba(148,163,184,0.2); padding-top: 20px; margin-top: 24px;">
                      <p style="color: #64748b; font-size: 12px; text-align: center; margin: 0;">APEX Financial Empire</p>
                    </div>
                  </div>
                </div>
              </body></html>
            `,
          });
          sent++;
        })
      );
      // Rate limit
      if (i + BATCH_SIZE < applicants.length) await new Promise(r => setTimeout(r, 600));
    }

    return new Response(JSON.stringify({ success: true, sent, total: applicants.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
