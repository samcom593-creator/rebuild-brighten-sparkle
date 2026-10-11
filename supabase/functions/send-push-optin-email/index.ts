import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
// 2026-08-17: bumped off supabase-js@2.50.0 — esm.sh resolves transitive deps at
// request time, so that pin pinned nothing underneath it and now fails to resolve
// ws's optional native deps (bufferutil / utf-8-validate). The function died at
// BOOT, before the handler, so every call 500d and nothing recorded a reason.
// Measured 2026-08-17: send-notification 903/903 failures in 24h, poke-pusher
// 164/164, metricool-sync 3/3 — zero 200s. 2.90.1 is the version proven booting.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { requireSendAuth } from "../_shared/require-send-auth.ts";

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

  // PL-WIB-PUSH-OPTIN-AUTH (2026-10-11). verify_jwt = false and, until this
  // commit, no credential read, so a bare POST from anyone emailed every
  // non-terminated applicant with an address (836 on 2026-10-11) from
  // notifications@apex-financial.org, 1s apart, with no dedupe: every POST
  // repeats the whole send. The only caller is NotificationHub's opt-in button
  // (requireAdmin route, user JWT); src/pg_proc/cron otherwise 0, so the
  // admin_or_manager floor locks out nobody.
  const auth = await requireSendAuth(req);
  if (!auth.ok) {
    return new Response(JSON.stringify({ error: auth.error }), {
      status: auth.status,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  // dryRun returns the audience size and sends nothing, so the deployed gate
  // can be proven with the service key without mailing 836 people. The UI
  // posts {}, which is not a dry run.
  const reqBody = await req.json().catch(() => ({}));
  const dryRun = reqBody?.dryRun === true;

  try {
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });
    const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

    // Fetch all active applicants with email
    const { data: applicants, error: applicantsError } = await supabase
      .from("applications")
      .select("id, email, first_name, last_name")
      .is("terminated_at", null)
      .not("email", "is", null);
    if (applicantsError) throw applicantsError;

    if (dryRun) {
      return new Response(
        JSON.stringify({ dryRun: true, total: applicants?.length ?? 0 }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    let sent = 0;
    let failed = 0;

    for (const app of applicants || []) {
      try {
        await resend.emails.send({
          from: "Galaxy Financial <notifications@apex-financial.org>",
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
                  Enable push notifications so you never miss important updates from Galaxy Financial — 
                  new training resources, team announcements, and opportunities delivered straight to your phone.
                </p>
                <div style="text-align: center; margin: 30px 0;">
                  <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 auto;">
                    <tr>
                      <td align="center" bgcolor="#3b82f6" style="border-radius:10px;">
                        <a href="https://apex-financial.org/dashboard/settings" style="display:inline-block;color:#ffffff;text-decoration:none;padding:16px 40px;font-weight:700;font-size:18px;">
                          Enable Notifications →
                        </a>
                      </td>
                    </tr>
                  </table>
                </div>
                <p style="font-size: 14px; color: #6b7280;">
                  Tap the button above to install the Galaxy Financial app on your phone and enable instant notifications. 
                  It takes less than 30 seconds!
                </p>
                <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
                <p style="color: #9ca3af; font-size: 12px; text-align: center;">Powered by Galaxy Financial</p>
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
