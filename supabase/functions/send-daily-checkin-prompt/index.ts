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
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Fetch all unlicensed, non-terminated applications
    const { data: applicants, error } = await supabaseClient
      .from("applications")
      .select("id, first_name, last_name, email, license_status, license_progress")
      .is("terminated_at", null)
      .neq("license_status", "licensed")
      .not("license_progress", "eq", "licensed");

    if (error) throw error;
    if (!applicants?.length) {
      return new Response(JSON.stringify({ success: true, message: "No unlicensed applicants to prompt" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let sent = 0;
    const BATCH_SIZE = 10;

    for (let i = 0; i < applicants.length; i += BATCH_SIZE) {
      const batch = applicants.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(async (app) => {
          if (!app.email) return;
          const checkinUrl = `${APP_URL}/checkin?id=${app.id}`;

          await resend.emails.send({
            from: "APEX Financial Empire <notifications@tx.apex-financial.org>",
            to: [app.email],
            subject: "📋 Daily Check-In — Update Your Licensing Progress",
            html: `
              <!DOCTYPE html>
              <html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
              <body style="font-family: 'Segoe UI', sans-serif; margin: 0; padding: 0; background-color: #0a0f1a;">
                <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
                  <div style="background: linear-gradient(135deg, #0d1526, #1a2a4a); border-radius: 16px; padding: 40px; border: 1px solid rgba(20,184,166,0.3);">
                    <h1 style="color: #14b8a6; font-size: 22px; margin: 0 0 16px;">Hey ${app.first_name}! 👋</h1>
                    <p style="color: #e2e8f0; font-size: 16px; line-height: 1.6; margin: 0 0 20px;">
                      It's time for your <strong>daily licensing check-in</strong>. Take 30 seconds to update where you are in the process — this helps us track your progress and get you support faster.
                    </p>
                    <p style="color: #94a3b8; font-size: 14px; margin: 0 0 24px;">
                      Fill this out every day so your manager knows exactly how to help you.
                    </p>
                    <div style="text-align: center; margin: 24px 0;">
                      <a href="${checkinUrl}" style="display: inline-block; background: linear-gradient(135deg, #14b8a6, #0d9488); color: #0a0f1a; text-decoration: none; padding: 16px 40px; border-radius: 8px; font-weight: bold; font-size: 16px;">
                        Complete My Check-In →
                      </a>
                    </div>
                    <div style="border-top: 1px solid rgba(148,163,184,0.2); padding-top: 20px; margin-top: 20px;">
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
    }

    console.log(`Sent ${sent} daily checkin prompts`);
    return new Response(JSON.stringify({ success: true, sent }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Error in send-daily-checkin-prompt:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
