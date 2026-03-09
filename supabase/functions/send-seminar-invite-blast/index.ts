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

function buildSeminarEmail(firstName: string, registrationUrl: string, whatsappLink: string): string {
  return `
<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0f172a;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;padding:32px 16px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#1e293b;border-radius:16px;overflow:hidden;border:1px solid #334155;">

<!-- Header -->
<tr><td style="background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:32px;text-align:center;">
  <h1 style="color:#ffffff;margin:0;font-size:28px;font-weight:800;">📅 You're Invited!</h1>
  <p style="color:#e0e7ff;margin:8px 0 0;font-size:16px;">Weekly Career Seminar — This Thursday</p>
</td></tr>

<!-- Body -->
<tr><td style="padding:32px;">
  <p style="color:#e2e8f0;font-size:16px;line-height:1.6;margin:0 0 16px;">
    Hey ${firstName} 👋
  </p>
  <p style="color:#e2e8f0;font-size:16px;line-height:1.6;margin:0 0 16px;">
    You're invited to our <strong style="color:#a5b4fc;">Weekly Career Seminar</strong> this <strong>Thursday at 7:00 PM CST</strong>. 
    This is a free, live session where you'll get a full overview of the opportunity at Apex Financial, hear from top producers, 
    and get all your questions answered.
  </p>

  <table width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;">
  <tr><td style="background:#0f172a;border-radius:12px;padding:20px;border:1px solid #334155;">
    <h3 style="color:#a5b4fc;margin:0 0 12px;font-size:16px;">What You'll Learn:</h3>
    <ul style="color:#e2e8f0;font-size:14px;line-height:2;padding-left:20px;margin:0;">
      <li>How top agents are earning 6-figures in life insurance</li>
      <li>The exact systems and support you'll get</li>
      <li>Your licensing roadmap and next steps</li>
      <li>Live Q&A — ask anything!</li>
    </ul>
  </td></tr>
  </table>

  <!-- CTA Button -->
  <table width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;">
  <tr><td align="center">
    <a href="${registrationUrl}" style="display:inline-block;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#ffffff;text-decoration:none;padding:16px 40px;border-radius:12px;font-size:18px;font-weight:700;letter-spacing:0.5px;">
      Register Now — It's Free →
    </a>
  </td></tr>
  </table>

   <p style="color:#94a3b8;font-size:14px;text-align:center;margin:16px 0 0;">
     📍 Every Thursday • 7:00 PM CST • Virtual (link provided after registration)
   </p>

   ${whatsappLink ? `
   <!-- WhatsApp CTA -->
   <table width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;">
   <tr><td align="center">
     <a href="${whatsappLink}" style="display:inline-block;background:linear-gradient(135deg,#25D366,#128C7E);color:#ffffff;text-decoration:none;padding:14px 36px;border-radius:12px;font-size:16px;font-weight:700;">
       💬 Join Our WhatsApp Group →
     </a>
   </td></tr>
   <tr><td align="center" style="padding-top:8px;">
     <p style="color:#94a3b8;font-size:13px;margin:0;">Connect with the team, get daily updates & support</p>
   </td></tr>
   </table>` : ""}
</td></tr>

<!-- Footer -->
<tr><td style="padding:20px 32px;border-top:1px solid #334155;text-align:center;">
  <p style="color:#64748b;font-size:11px;margin:0;">Powered by Apex Financial</p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const resendKey = Deno.env.get("RESEND_API_KEY")!;
    const whatsappLink = Deno.env.get("WHATSAPP_GROUP_LINK") || "";

    const sb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const resend = new Resend(resendKey);

    // Fetch all unlicensed, non-terminated applicants
    const { data: apps, error: appsErr } = await sb
      .from("applications")
      .select("id, first_name, last_name, email, phone, carrier, license_status")
      .eq("license_status", "unlicensed")
      .is("terminated_at", null);

    if (appsErr) throw appsErr;
    if (!apps || apps.length === 0) {
      return new Response(JSON.stringify({ success: true, total: 0, message: "No unlicensed applicants found" }), {
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    let emailsSent = 0, smsSent = 0, pushSent = 0;

    for (const app of apps) {
      const regUrl = `${APP_URL}/seminar?first_name=${encodeURIComponent(app.first_name)}&last_name=${encodeURIComponent(app.last_name || "")}&email=${encodeURIComponent(app.email)}`;

      // --- EMAIL ---
      try {
        await resend.emails.send({
           from: "APEX Financial Empire <notifications@apex-financial.org>",
          to: [app.email],
          subject: "📅 You're Invited: Weekly Career Seminar — This Thursday!",
          html: buildSeminarEmail(app.first_name, regUrl, whatsappLink),
        });
        emailsSent++;
        await sb.from("notification_log").insert({
          recipient_email: app.email,
          channel: "email",
          title: "Seminar Invite",
          message: `Seminar invite sent to ${app.first_name}`,
          status: "sent",
        });
      } catch (e) {
        console.error(`Email failed for ${app.email}:`, e);
        await sb.from("notification_log").insert({
          recipient_email: app.email,
          channel: "email",
          title: "Seminar Invite",
          message: `Seminar invite to ${app.first_name}`,
          status: "failed",
          error_message: String(e),
        });
      }

      // --- SMS ---
      if (app.phone) {
        const digits = app.phone.replace(/\D/g, "").slice(-10);
        if (digits.length === 10) {
          const smsText = `${app.first_name}, free seminar Thu 7PM CST! Register: ${APP_URL}/seminar`;
          const carrier = app.carrier || null;
          const gateways = carrier && CARRIER_GATEWAYS[carrier]
            ? [CARRIER_GATEWAYS[carrier]]
            : Object.values(CARRIER_GATEWAYS);

          let smsSentForThis = false;
          for (const gw of gateways) {
            try {
              await resend.emails.send({
                from: "APEX Financial Empire <notifications@apex-financial.org>",
                to: [`${digits}@${gw}`],
                subject: "",
                text: smsText,
              });
              smsSentForThis = true;
              if (carrier) break; // known carrier, one attempt
            } catch {}
          }
          if (smsSentForThis) {
            smsSent++;
            await sb.from("notification_log").insert({
              recipient_phone: app.phone,
              channel: "sms",
              title: "Seminar Invite SMS",
              message: smsText.substring(0, 200),
              status: "sent",
            });
          }
        }
      }

      // --- PUSH ---
      try {
        const { data: profile } = await sb.from("profiles").select("user_id").eq("email", app.email).maybeSingle();
        if (profile?.user_id) {
          await sb.functions.invoke("send-push-notification", {
            body: {
              userId: profile.user_id,
              title: "📅 Career Seminar — This Thursday!",
              body: `Hey ${app.first_name}, register for our free weekly seminar! Get a full overview of the opportunity.`,
              url: regUrl,
            },
          });
          pushSent++;
        }
      } catch {}
    }

    console.log(`Seminar blast complete: ${emailsSent} emails, ${smsSent} SMS, ${pushSent} push to ${apps.length} applicants`);

    return new Response(
      JSON.stringify({ success: true, total: apps.length, email: emailsSent, sms: smsSent, push: pushSent }),
      { headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (err: any) {
    console.error("Seminar blast error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
});
