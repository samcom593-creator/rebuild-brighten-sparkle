import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";
import { Resend } from "https://esm.sh/resend@2.0.0";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });
    const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

    // Fetch all active applicants with email
    const { data: applicants } = await supabase
      .from("applications")
      .select("id, email, first_name, last_name")
      .is("terminated_at", null)
      .not("email", "is", null);

    let sent = 0;
    let failed = 0;

    for (const app of applicants || []) {
      try {
        await resend.emails.send({
          from: "Apex Financial <notifications@apex-financial.org>",
          to: [app.email],
          subject: "📲 Stay in the Loop — Enable Push Notifications!",
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background: linear-gradient(135deg, #3b82f6, #1d4ed8); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
                <h1 style="color: white; margin: 0; font-size: 24px;">Never Miss an Update! 📲</h1>
              </div>
              <div style="background: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px;">
                <p style="font-size: 16px; color: #374151;">Hey ${app.first_name}!</p>
                <p style="font-size: 16px; color: #374151;">
                  Enable push notifications so you never miss important updates from Apex Financial — 
                  new training resources, team announcements, and opportunities delivered straight to your phone.
                </p>
                <div style="text-align: center; margin: 30px 0;">
                  <a href="https://rebuild-brighten-sparkle.lovable.app/dashboard/settings" 
                     style="display: inline-block; background: linear-gradient(135deg, #3b82f6, #1d4ed8); color: white; text-decoration: none; padding: 16px 40px; border-radius: 10px; font-weight: 700; font-size: 18px;">
                    Enable Notifications →
                  </a>
                </div>
                <p style="font-size: 14px; color: #6b7280;">
                  Tap the button above to install the Apex Financial app on your phone and enable instant notifications. 
                  It takes less than 30 seconds!
                </p>
                <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
                <p style="color: #9ca3af; font-size: 12px; text-align: center;">Powered by Apex Financial</p>
              </div>
            </div>
          `,
        });

        await supabase.from("notification_log").insert({
          recipient_email: app.email,
          channel: "email",
          title: "Push Opt-In Email",
          message: `Sent push opt-in encouragement to ${app.first_name} ${app.last_name || ""}`,
          status: "sent",
          metadata: { trigger: "push-optin", application_id: app.id },
        });
        sent++;
      } catch (err: any) {
        console.error(`Opt-in email failed for ${app.email}:`, err);
        failed++;
      }
      await delay(1000);
    }

    console.log(`Push opt-in emails: sent=${sent}, failed=${failed}`);

    return new Response(
      JSON.stringify({ success: true, sent, failed, total: (applicants?.length || 0) }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: any) {
    console.error("Error in send-push-optin-email:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);
