import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";
import { Resend } from "https://esm.sh/resend@2.0.0";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const CARRIER_GATEWAYS: Record<string, string> = {
  att: "txt.att.net",
  verizon: "vtext.com",
  tmobile: "tmomail.net",
  sprint: "messaging.sprintpcs.com",
  uscellular: "email.uscc.net",
  cricket: "sms.cricketwireless.net",
  metro: "mymetropcs.com",
  boost: "sms.myboostmobile.com",
};

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function logNotification(supabase: any, data: any) {
  try {
    await supabase.from("notification_log").insert(data);
  } catch (e) {
    console.error("Log failed:", e);
  }
}

// Try sending push notification for an applicant by looking up their agent record
async function trySendPush(supabaseUrl: string, serviceRoleKey: string, supabase: any, app: any): Promise<boolean> {
  try {
    // Find agent linked to this applicant's email
    const { data: profile } = await supabase
      .from("profiles")
      .select("user_id")
      .ilike("email", app.email)
      .maybeSingle();

    if (!profile?.user_id) return false;

    const pushResponse = await fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify({
        userId: profile.user_id,
        title: "Apex Financial Update 🚀",
        body: `Hey ${app.first_name}! Check your email for important updates from Apex Financial.`,
        url: "/dashboard",
      }),
    });
    const pushResult = await pushResponse.json();
    const success = pushResult.sent > 0;

    await logNotification(supabase, {
      recipient_email: app.email,
      channel: "push",
      title: "Bulk Blast Push",
      message: `Push to ${app.first_name} ${app.last_name || ""}`,
      status: success ? "sent" : "failed",
      error_message: success ? null : "No push subscriptions",
      metadata: { trigger: "bulk-blast", type: "push" },
    });

    return success;
  } catch (err: any) {
    console.error(`Push failed for ${app.email}:`, err);
    return false;
  }
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

    const stats = {
      applicants_emailed: 0,
      aged_emailed: 0,
      sms_sent: 0,
      sms_auto_detected: 0,
      push_sent: 0,
      failed: 0,
      total: 0,
    };

    // 1. Fetch all active applicants (not terminated)
    const { data: applicants } = await supabase
      .from("applications")
      .select("id, email, first_name, last_name, license_status, phone, carrier")
      .is("terminated_at", null)
      .not("email", "is", null);

    // 2. Fetch all aged leads
    const { data: agedLeads } = await supabase
      .from("aged_leads")
      .select("id, email, first_name, last_name, phone, status")
      .not("email", "is", null);

    console.log(`Blast: ${applicants?.length || 0} applicants, ${agedLeads?.length || 0} aged leads`);

    // Process applicants — send push + SMS + email (all channels)
    for (const app of applicants || []) {
      stats.total++;
      try {
        // 1. Push notification (fire and don't block)
        const pushSuccess = await trySendPush(supabaseUrl, serviceRoleKey, supabase, app);
        if (pushSuccess) stats.push_sent++;

        // 2. Email: licensing instructions
        const resp = await fetch(`${supabaseUrl}/functions/v1/send-licensing-instructions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${serviceRoleKey}`,
          },
          body: JSON.stringify({
            email: app.email,
            firstName: app.first_name,
            licenseStatus: app.license_status || "unlicensed",
          }),
        });

        const result = await resp.json();
        const success = resp.ok && result.success;

        await logNotification(supabase, {
          recipient_email: app.email,
          channel: "email",
          title: "Licensing Instructions",
          message: `Sent licensing instructions to ${app.first_name} ${app.last_name || ""}`,
          status: success ? "sent" : "failed",
          error_message: success ? null : (result.error || "Unknown error"),
          metadata: { trigger: "bulk-blast", type: "applicant", application_id: app.id },
        });

        if (success) stats.applicants_emailed++;
        else stats.failed++;

        // 3. SMS: known carrier → direct, unknown carrier → auto-detect
        if (app.phone) {
          if (app.carrier && CARRIER_GATEWAYS[app.carrier]) {
            const cleaned = app.phone.replace(/\D/g, "").slice(-10);
            if (cleaned.length === 10) {
              try {
                const smsEmail = `${cleaned}@${CARRIER_GATEWAYS[app.carrier]}`;
                await resend.emails.send({
                  from: "Apex Financial <notifications@tx.apex-financial.org>",
                  to: [smsEmail],
                  subject: "",
                  text: `Hey ${app.first_name}! Apex Financial sent you licensing resources — check your email! 🚀`.substring(0, 160),
                });
                stats.sms_sent++;
                await logNotification(supabase, {
                  recipient_email: app.email,
                  recipient_phone: app.phone,
                  channel: "sms",
                  title: "Licensing SMS",
                  message: `SMS to ${app.first_name}: check email for licensing resources`,
                  status: "sent",
                  metadata: { trigger: "bulk-blast", type: "applicant-sms", carrier: app.carrier },
                });
              } catch (smsErr: any) {
                console.error(`SMS failed for ${app.email}:`, smsErr);
              }
            }
          } else {
            // No carrier — auto-detect
            try {
              const autoResp = await fetch(`${supabaseUrl}/functions/v1/send-sms-auto-detect`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${serviceRoleKey}`,
                },
                body: JSON.stringify({
                  phone: app.phone,
                  message: `Hey ${app.first_name}! Apex Financial sent you licensing resources — check your email! 🚀`.substring(0, 160),
                  applicationId: app.id,
                }),
              });
              const autoResult = await autoResp.json();
              if (autoResult.successCount > 0) stats.sms_auto_detected++;
            } catch (autoErr: any) {
              console.error(`SMS auto-detect failed for ${app.email}:`, autoErr);
            }
          }
        }
      } catch (err: any) {
        console.error(`Failed for applicant ${app.email}:`, err);
        stats.failed++;
      }
      await delay(1000);
    }

    // Process aged leads — send push + SMS + email
    for (const lead of agedLeads || []) {
      stats.total++;
      try {
        // 1. Push (try)
        const pushSuccess = await trySendPush(supabaseUrl, serviceRoleKey, supabase, lead);
        if (pushSuccess) stats.push_sent++;

        // 2. Email: re-engagement
        const resp = await fetch(`${supabaseUrl}/functions/v1/send-aged-lead-email`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${serviceRoleKey}`,
          },
          body: JSON.stringify({
            email: lead.email,
            firstName: lead.first_name,
          }),
        });

        const result = await resp.json();
        const success = resp.ok && !result.error;

        await logNotification(supabase, {
          recipient_email: lead.email,
          channel: "email",
          title: "Aged Lead Re-engagement",
          message: `Re-engagement email to ${lead.first_name} ${lead.last_name || ""}`,
          status: success ? "sent" : "failed",
          error_message: success ? null : (result.error || "Unknown error"),
          metadata: { trigger: "bulk-blast", type: "aged-lead", aged_lead_id: lead.id },
        });

        if (success) stats.aged_emailed++;
        else stats.failed++;

        // 3. SMS auto-detect for aged leads
        if (lead.phone) {
          try {
            const autoResp = await fetch(`${supabaseUrl}/functions/v1/send-sms-auto-detect`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${serviceRoleKey}`,
              },
              body: JSON.stringify({
                phone: lead.phone,
                message: `Hey ${lead.first_name}! Apex Financial has big updates — check your email! 🚀`.substring(0, 160),
                agedLeadId: lead.id,
              }),
            });
            const autoResult = await autoResp.json();
            if (autoResult.successCount > 0) stats.sms_auto_detected++;
          } catch (autoErr: any) {
            console.error(`SMS auto-detect failed for aged lead ${lead.email}:`, autoErr);
          }
        }
      } catch (err: any) {
        console.error(`Failed for aged lead ${lead.email}:`, err);
        stats.failed++;
      }
      await delay(1000);
    }

    console.log("Bulk blast complete:", stats);

    return new Response(
      JSON.stringify({ success: true, stats }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: any) {
    console.error("Error in send-bulk-notification-blast:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);
