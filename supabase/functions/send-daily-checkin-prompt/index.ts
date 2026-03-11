import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";
import { Resend } from "https://esm.sh/resend@2.0.0";

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

const APP_URL = "https://rebuild-brighten-sparkle.lovable.app";

async function logNotification(supabase: any, data: any) {
  try {
    await supabase.from("notification_log").insert(data);
  } catch (e) {
    console.error("Log failed:", e);
  }
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const whatsappLink = Deno.env.get("WHATSAPP_GROUP_LINK") || "";
    const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

    const supabaseClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    // Fetch all unlicensed, non-terminated applications
    const { data: applicants, error } = await supabaseClient
      .from("applications")
      .select("id, first_name, last_name, email, phone, carrier, license_status, license_progress")
      .is("terminated_at", null)
      .neq("license_status", "licensed")
      .not("license_progress", "eq", "licensed");

    if (error) throw error;
    if (!applicants?.length) {
      return new Response(JSON.stringify({ success: true, message: "No unlicensed applicants to prompt" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results = { email: 0, sms: 0, push: 0 };
    const BATCH_SIZE = 5;

    for (let i = 0; i < applicants.length; i += BATCH_SIZE) {
      const batch = applicants.slice(i, i + BATCH_SIZE);
      await Promise.allSettled(batch.map(async (app) => {
        const checkinUrl = `${APP_URL}/checkin?id=${app.id}`;
        const smsText = `Daily check-in time! Update your licensing progress: ${checkinUrl}${whatsappLink ? ` | Join WhatsApp: ${whatsappLink}` : ""}`
          .substring(0, 160);

        // 1. EMAIL
        if (app.email) {
          try {
            await resend.emails.send({
              from: "APEX Financial Empire <notifications@apex-financial.org>",
              to: [app.email],
              cc: ["sam@apex-financial.org"],
              subject: "📋 Daily Check-In — Update Your Licensing Progress",
              html: `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family:'Segoe UI',sans-serif;margin:0;padding:0;background-color:#0a0f1a;">
<div style="max-width:600px;margin:0 auto;padding:40px 20px;">
<div style="background:linear-gradient(135deg,#0d1526,#1a2a4a);border-radius:16px;padding:40px;border:1px solid rgba(20,184,166,0.3);">
  <h1 style="color:#14b8a6;font-size:22px;margin:0 0 16px;">Hey ${app.first_name}! 👋</h1>
  <p style="color:#e2e8f0;font-size:16px;line-height:1.6;margin:0 0 20px;">
    It's time for your <strong>daily licensing check-in</strong>. Take 30 seconds to update where you are in the process — this helps us track your progress and get you support faster.
  </p>
  <p style="color:#94a3b8;font-size:14px;margin:0 0 24px;">
    Fill this out every day so your manager knows exactly how to help you.
  </p>
  <div style="text-align:center;margin:24px 0;">
    <a href="${checkinUrl}" style="display:inline-block;background:linear-gradient(135deg,#14b8a6,#0d9488);color:#0a0f1a;text-decoration:none;padding:16px 40px;border-radius:8px;font-weight:bold;font-size:16px;">
      Complete My Check-In →
    </a>
  </div>
  ${whatsappLink ? `
  <div style="background:rgba(37,211,102,0.1);border:1px solid rgba(37,211,102,0.3);border-radius:8px;padding:16px;margin:20px 0;text-align:center;">
    <p style="color:#25D366;font-weight:bold;font-size:14px;margin:0 0 8px;">💬 Join Our WhatsApp Group</p>
    <p style="color:#94a3b8;font-size:13px;margin:0 0 12px;">Connect with other recruits and get real-time support.</p>
    <a href="${whatsappLink}" style="display:inline-block;background:#25D366;color:white;text-decoration:none;padding:10px 24px;border-radius:6px;font-weight:bold;font-size:14px;">Join WhatsApp →</a>
  </div>` : ""}
  <div style="border-top:1px solid rgba(148,163,184,0.2);padding-top:20px;margin-top:20px;">
    <p style="color:#64748b;font-size:12px;text-align:center;margin:0;">Powered by Apex Financial</p>
  </div>
</div></div></body></html>`,
            });
            results.email++;
            await logNotification(supabaseClient, {
              recipient_email: app.email,
              channel: "email",
              title: "Daily Check-In Prompt",
              message: "Daily licensing check-in prompt",
              status: "sent",
              metadata: { trigger: "daily-checkin-prompt", applicationId: app.id },
            });
          } catch (err: any) {
            await logNotification(supabaseClient, {
              recipient_email: app.email,
              channel: "email",
              title: "Daily Check-In Prompt",
              message: "Daily licensing check-in prompt",
              status: "failed",
              error_message: err.message,
              metadata: { trigger: "daily-checkin-prompt", applicationId: app.id },
            });
          }
        }

        // 2. SMS
        if (app.phone) {
          try {
            if (app.carrier && CARRIER_GATEWAYS[app.carrier]) {
              const cleaned = app.phone.replace(/\D/g, "").slice(-10);
              if (cleaned.length === 10) {
                const smsEmail = `${cleaned}@${CARRIER_GATEWAYS[app.carrier]}`;
                await resend.emails.send({
                  from: "Apex Financial <notifications@apex-financial.org>",
                  to: [smsEmail],
                  subject: "",
                  text: smsText,
                });
                results.sms++;
                await logNotification(supabaseClient, {
                  recipient_phone: app.phone,
                  channel: "sms",
                  title: "Daily Check-In Prompt",
                  message: smsText,
                  status: "sent",
                  metadata: { trigger: "daily-checkin-prompt", carrier: app.carrier, applicationId: app.id },
                });
              }
            } else {
              const autoResp = await fetch(`${supabaseUrl}/functions/v1/send-sms-auto-detect`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${serviceRoleKey}`,
                },
                body: JSON.stringify({ phone: app.phone, message: smsText, applicationId: app.id }),
              });
              const autoResult = await autoResp.json();
              if (autoResult.successCount > 0) results.sms++;
            }
          } catch (err: any) {
            console.error(`SMS failed for ${app.first_name}:`, err.message);
          }
        }

        // 3. PUSH
        if (app.email) {
          try {
            const { data: profile } = await supabaseClient
              .from("profiles")
              .select("user_id")
              .eq("email", app.email)
              .maybeSingle();
            if (profile?.user_id) {
              const pushResp = await fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${serviceRoleKey}`,
                },
                body: JSON.stringify({
                  userId: profile.user_id,
                  title: "📋 Daily Check-In Time!",
                  body: `Hey ${app.first_name}! Update your licensing progress now.`,
                  url: checkinUrl,
                }),
              });
              const pushResult = await pushResp.json();
              if (pushResult.sent > 0) results.push++;
            }
          } catch (err: any) {
            console.error(`Push failed for ${app.first_name}:`, err.message);
          }
        }
      }));

      if (i + BATCH_SIZE < applicants.length) {
        await new Promise(r => setTimeout(r, 500));
      }
    }

    console.log(`Daily checkin prompt: ${results.email} emails, ${results.sms} SMS, ${results.push} push`);
    return new Response(JSON.stringify({ success: true, ...results }), {
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
