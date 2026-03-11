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

function getLicensingSteps(progress: string | null): string {
  switch (progress) {
    case "not_started":
    case null:
      return `
        <h3 style="color:#14b8a6;font-size:16px;margin:16px 0 8px;">📚 Step 1: Purchase Your Pre-Licensing Course</h3>
        <ol style="color:#e2e8f0;font-size:14px;line-height:1.8;padding-left:20px;">
          <li>Go to <a href="https://www.xcelsolutions.com" style="color:#14b8a6;">XcelSolutions.com</a></li>
          <li>Select your state's Life & Health Insurance pre-licensing course</li>
          <li>Create an account and complete payment</li>
          <li>Start studying immediately — average agents finish in 5-7 days</li>
        </ol>
        <p style="color:#94a3b8;font-size:13px;margin-top:8px;">💡 <strong>Post in the WhatsApp group</strong> once you've purchased your course so we can track your progress!</p>`;
    case "course_purchased":
      return `
        <h3 style="color:#14b8a6;font-size:16px;margin:16px 0 8px;">📖 You're In the Course — Keep Going!</h3>
        <ul style="color:#e2e8f0;font-size:14px;line-height:1.8;padding-left:20px;">
          <li>Study 2-3 hours daily for the fastest results</li>
          <li>Focus on the practice exams — they mirror the real test</li>
          <li>Reach out in the WhatsApp group if you need study tips</li>
          <li>Most successful agents complete the course in under 2 weeks</li>
        </ul>
        <p style="color:#94a3b8;font-size:13px;margin-top:8px;">💡 <strong>Post in the WhatsApp group</strong> when you finish each module!</p>`;
    case "finished_course":
      return `
        <h3 style="color:#14b8a6;font-size:16px;margin:16px 0 8px;">🗓️ Time to Schedule Your Exam!</h3>
        <ol style="color:#e2e8f0;font-size:14px;line-height:1.8;padding-left:20px;">
          <li>Visit <a href="https://www.prometric.com" style="color:#14b8a6;">Prometric.com</a> or <a href="https://www.psionline.com" style="color:#14b8a6;">PSIOnline.com</a> (depends on your state)</li>
          <li>Search for "Life & Health Insurance" exam</li>
          <li>Pick the earliest available date near you</li>
          <li>Complete payment and save your confirmation</li>
        </ol>
        <p style="color:#94a3b8;font-size:13px;margin-top:8px;">💡 <strong>Post your test date in the WhatsApp group</strong> so your team can cheer you on!</p>`;
    case "test_scheduled":
      return `
        <h3 style="color:#14b8a6;font-size:16px;margin:16px 0 8px;">✅ Test Scheduled — Prepare to Pass!</h3>
        <ul style="color:#e2e8f0;font-size:14px;line-height:1.8;padding-left:20px;">
          <li>Review practice exams daily until your test date</li>
          <li>Focus on areas where you scored lowest</li>
          <li>Get a good night's sleep before the exam</li>
          <li>Bring two forms of ID to the testing center</li>
        </ul>
        <p style="color:#94a3b8;font-size:13px;margin-top:8px;">💡 <strong>Post in the WhatsApp group</strong> when you PASS — we'll celebrate together! 🎉</p>`;
    case "waiting_fingerprints":
      return `
        <h3 style="color:#14b8a6;font-size:16px;margin:16px 0 8px;">🖐️ Complete Your Fingerprints</h3>
        <ol style="color:#e2e8f0;font-size:14px;line-height:1.8;padding-left:20px;">
          <li>Visit your state's insurance department website for fingerprint requirements</li>
          <li>Schedule an appointment at an approved fingerprinting location</li>
          <li>Bring your exam pass confirmation and valid ID</li>
          <li>Pay the fingerprinting fee (usually $30-$50)</li>
        </ol>
        <p style="color:#94a3b8;font-size:13px;margin-top:8px;">💡 <strong>Post in the WhatsApp group</strong> once your fingerprints are done!</p>`;
    case "fingerprints_done":
      return `
        <h3 style="color:#14b8a6;font-size:16px;margin:16px 0 8px;">⏳ Almost There — License Processing</h3>
        <ul style="color:#e2e8f0;font-size:14px;line-height:1.8;padding-left:20px;">
          <li>Your state is processing your application — typically 1-3 weeks</li>
          <li>Check your state insurance department portal for status updates</li>
          <li>Make sure all fees are paid and documents submitted</li>
          <li>Start preparing for contracting while you wait</li>
        </ul>
        <p style="color:#94a3b8;font-size:13px;margin-top:8px;">💡 <strong>Post in the WhatsApp group</strong> the moment you receive your license number! 🏆</p>`;
    case "waiting_on_license":
      return `
        <h3 style="color:#14b8a6;font-size:16px;margin:16px 0 8px;">📋 License Is Being Issued</h3>
        <ul style="color:#e2e8f0;font-size:14px;line-height:1.8;padding-left:20px;">
          <li>Processing usually takes 1-3 weeks after all documents are submitted</li>
          <li>Check your state's NIPR database daily for your license number</li>
          <li>Once issued, send your license number to your manager immediately</li>
          <li>We'll get you contracted and in the field ASAP!</li>
        </ul>
        <p style="color:#94a3b8;font-size:13px;margin-top:8px;">💡 <strong>Post your NIPR number in the WhatsApp group</strong> — you're about to start earning! 💰</p>`;
    default:
      return `
        <h3 style="color:#14b8a6;font-size:16px;margin:16px 0 8px;">📋 Your Next Steps</h3>
        <p style="color:#e2e8f0;font-size:14px;line-height:1.8;">
          Check in daily so we know exactly where you are in the licensing process and can support you. Post your updates in the WhatsApp group!
        </p>`;
  }
}

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

    // Fetch all unlicensed, non-terminated applicants
    const { data: applicants, error } = await supabaseClient
      .from("applications")
      .select("id, first_name, last_name, email, phone, carrier, license_status, license_progress")
      .is("terminated_at", null)
      .neq("license_status", "licensed");

    if (error) throw error;
    if (!applicants?.length) {
      return new Response(JSON.stringify({ success: true, sent: 0, message: "No unlicensed applicants" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results = { email: 0, sms: 0, push: 0, total: applicants.length };
    const BATCH_SIZE = 5;

    for (let i = 0; i < applicants.length; i += BATCH_SIZE) {
      const batch = applicants.slice(i, i + BATCH_SIZE);
      await Promise.allSettled(batch.map(async (app) => {
        const checkinUrl = `${APP_URL}/checkin?id=${app.id}`;
        // Send WhatsApp link as priority — no truncation
        const smsText = whatsappLink
          ? `Hey ${app.first_name}! Join our APEX WhatsApp group for daily updates & support: ${whatsappLink}`
          : `Hey ${app.first_name}! Update your licensing progress: ${checkinUrl}`;

        // 1. EMAIL
        if (app.email) {
          try {
            await resend.emails.send({
              from: "APEX Financial Empire <notifications@apex-financial.org>",
              to: [app.email],
              cc: ["sam@apex-financial.org"],
              subject: "📲 Join Our WhatsApp Group + Update Your Licensing Progress",
              html: `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family:'Segoe UI',sans-serif;margin:0;padding:0;background-color:#0a0f1a;">
<div style="max-width:600px;margin:0 auto;padding:40px 20px;">
<div style="background:linear-gradient(135deg,#0d1526,#1a2a4a);border-radius:16px;padding:40px;border:1px solid rgba(20,184,166,0.3);">
  <h1 style="color:#14b8a6;font-size:22px;margin:0 0 16px;">Hey ${app.first_name}! 👋</h1>
  <p style="color:#e2e8f0;font-size:16px;line-height:1.6;margin:0 0 20px;">
    We're building something special at <strong>APEX Financial Empire</strong> and we want you in the loop! Join our WhatsApp group to connect with other recruits, get real-time support, and celebrate milestones together.
  </p>
  <p style="color:#94a3b8;font-size:14px;margin:0 0 8px;">
    <strong style="color:#e2e8f0;">Once you reach each milestone, post your update in the WhatsApp group so everyone can celebrate with you!</strong>
  </p>
  ${whatsappLink ? `
  <div style="text-align:center;margin:24px 0;">
    <a href="${whatsappLink}" style="display:inline-block;background:linear-gradient(135deg,#25D366,#128C7E);color:white;text-decoration:none;padding:16px 40px;border-radius:8px;font-weight:bold;font-size:16px;">
      💬 Join WhatsApp Group →
    </a>
  </div>` : ""}
  ${getLicensingSteps(app.license_progress)}
  <div style="text-align:center;margin:24px 0;">
    <a href="${checkinUrl}" style="display:inline-block;background:linear-gradient(135deg,#14b8a6,#0d9488);color:#0a0f1a;text-decoration:none;padding:14px 36px;border-radius:8px;font-weight:bold;font-size:15px;">
      📋 Complete Daily Check-In →
    </a>
  </div>
  <div style="background:rgba(20,184,166,0.1);border:1px solid rgba(20,184,166,0.3);border-radius:8px;padding:16px;margin:20px 0;">
    <p style="color:#14b8a6;font-weight:bold;font-size:14px;margin:0 0 8px;">📊 Why Check In Daily?</p>
    <ul style="color:#94a3b8;font-size:13px;margin:0;padding-left:20px;line-height:1.8;">
      <li>Your manager can see exactly where you are and help faster</li>
      <li>Track your own progress toward getting licensed</li>
      <li>Stay accountable with the team</li>
      <li>The average agent produces <strong style="color:#14b8a6;">$20,000+ in their first month</strong></li>
    </ul>
  </div>
  <div style="border-top:1px solid rgba(148,163,184,0.2);padding-top:20px;margin-top:20px;">
    <p style="color:#64748b;font-size:12px;text-align:center;margin:0;">Powered by Apex Financial</p>
  </div>
</div></div></body></html>`,
            });
            results.email++;
            await logNotification(supabaseClient, {
              recipient_email: app.email,
              channel: "email",
              title: "WhatsApp Onboarding Blast",
              message: "WhatsApp group invite + licensing steps + daily check-in",
              status: "sent",
              metadata: { trigger: "whatsapp-onboarding-blast", applicationId: app.id },
            });
          } catch (err: any) {
            await logNotification(supabaseClient, {
              recipient_email: app.email,
              channel: "email",
              title: "WhatsApp Onboarding Blast",
              message: "WhatsApp group invite + licensing steps + daily check-in",
              status: "failed",
              error_message: err.message,
              metadata: { trigger: "whatsapp-onboarding-blast", applicationId: app.id },
            });
          }
        }

        // 2. SMS (known carrier or auto-detect)
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
                  title: "WhatsApp Onboarding Blast",
                  message: smsText,
                  status: "sent",
                  metadata: { trigger: "whatsapp-onboarding-blast", carrier: app.carrier, applicationId: app.id },
                });
              }
            } else {
              // Auto-detect
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

        // 3. PUSH (lookup profile by email)
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
                  title: "📲 Join Our WhatsApp Group!",
                  body: `Hey ${app.first_name}! Join the WhatsApp group and update your licensing progress.`,
                  url: whatsappLink || checkinUrl,
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

      // Small delay between batches
      if (i + BATCH_SIZE < applicants.length) {
        await new Promise(r => setTimeout(r, 500));
      }
    }

    console.log(`WhatsApp Onboarding Blast: ${results.email} emails, ${results.sms} SMS, ${results.push} push to ${results.total} applicants`);

    return new Response(JSON.stringify({ success: true, ...results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Error in send-whatsapp-onboarding-blast:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
