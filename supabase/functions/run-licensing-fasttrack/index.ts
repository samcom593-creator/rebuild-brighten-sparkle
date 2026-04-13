import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const RESEND_URL = "https://api.resend.com/emails";

const fastTrackMessages: Record<number, { subject: string; sms: string; urgency: string }> = {
  1: {
    subject: "[FirstName], your license is waiting — here's exactly what to do today",
    sms: "APEX: [Name] — your license path starts NOW. Step 1: Purchase the pre-licensing course today. Takes 10 min.",
    urgency: "low",
  },
  2: {
    subject: "Day 2 — [FirstName], have you purchased your course yet?",
    sms: "APEX: [Name] — Day 2. Did you buy the course yet? Every day you wait = $200+ in commissions lost.",
    urgency: "medium",
  },
  3: {
    subject: "[FirstName] — the agents who get licensed in 2 weeks do THIS on day 3",
    sms: "APEX: [Name] — agents who start the course by Day 3 get licensed 3x faster. Start today.",
    urgency: "medium",
  },
  5: {
    subject: "5 days in — [FirstName], where are you in the process?",
    sms: "APEX: [Name] — 5 days since you joined. Quick reply: 1=just bought course, 2=studying, 3=need help",
    urgency: "high",
  },
  7: {
    subject: "[FirstName] — 1 week in. Are you on track?",
    sms: "APEX: [Name] — 1 week in. If you haven't passed your exam yet, reply and I'll help you schedule it.",
    urgency: "high",
  },
  10: {
    subject: "[FirstName], your exam should be scheduled by now",
    sms: "APEX: [Name] — schedule your exam TODAY at PSI or Pearson VUE. Takes 5 min. Text back when done.",
    urgency: "critical",
  },
  14: {
    subject: "2 weeks, [FirstName] — Sam personally wants to know what's blocking you",
    sms: "APEX: Hey [Name] — Sam here. 2 weeks in. What's your blocker? Reply now and I'll personally help.",
    urgency: "critical",
  },
  21: {
    subject: "[FirstName] — 3 weeks. Last check-in before we need to make a decision.",
    sms: "APEX: [Name] — 21 days. We need to see progress or we'll need to have a conversation. Reply with your exam date.",
    urgency: "maximum",
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const resendKey = Deno.env.get("RESEND_API_KEY");
    const supabase = createClient(supabaseUrl, serviceKey);

    // Get all unlicensed contracted agents
    const { data: unlicensedApps } = await supabase
      .from("applications")
      .select("id, first_name, last_name, email, phone, contracted_at, license_progress, carrier")
      .eq("license_status", "unlicensed")
      .is("terminated_at", null)
      .not("contracted_at", "is", null)
      .neq("license_progress", "licensed");

    if (!unlicensedApps || unlicensedApps.length === 0) {
      return new Response(JSON.stringify({ message: "No unlicensed agents to process" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let sent = 0;
    for (const app of unlicensedApps) {
      const daysSinceContract = Math.floor(
        (Date.now() - new Date(app.contracted_at).getTime()) / 86400000
      );

      const template = fastTrackMessages[daysSinceContract];
      if (!template) continue;

      const firstName = app.first_name;
      const fullName = `${app.first_name} ${app.last_name}`;
      const subject = template.subject.replace("[FirstName]", firstName);
      const smsText = template.sms.replace("[Name]", firstName).replace("[Name]", firstName);

      // Send email
      if (resendKey && app.email) {
        try {
          const licensingSteps = daysSinceContract === 1 ? `
            <div style="background:#0f172a;border-radius:12px;padding:20px;margin:20px 0">
              <div style="font-size:14px;font-weight:700;color:#22d3a5;margin-bottom:12px">YOUR EXACT PATH TO LICENSED IN 14 DAYS:</div>
              <div>
                <div style="padding:8px 0;border-bottom:1px solid #1e293b;font-size:13px;color:rgba(255,255,255,0.8)">
                  <span style="color:#22d3a5;font-weight:700">Day 1-2:</span> Purchase pre-licensing course
                </div>
                <div style="padding:8px 0;border-bottom:1px solid #1e293b;font-size:13px;color:rgba(255,255,255,0.8)">
                  <span style="color:#22d3a5;font-weight:700">Day 3-10:</span> Study 2-3 hours daily. Aim for 85%+ on practice tests
                </div>
                <div style="padding:8px 0;border-bottom:1px solid #1e293b;font-size:13px;color:rgba(255,255,255,0.8)">
                  <span style="color:#22d3a5;font-weight:700">Day 5:</span> Schedule your exam at pearsonvue.com
                </div>
                <div style="padding:8px 0;border-bottom:1px solid #1e293b;font-size:13px;color:rgba(255,255,255,0.8)">
                  <span style="color:#22d3a5;font-weight:700">Day 10-14:</span> Take your exam. Pass. Text us immediately.
                </div>
                <div style="padding:8px 0;font-size:13px;color:rgba(255,255,255,0.8)">
                  <span style="color:#22d3a5;font-weight:700">Day 14-21:</span> Fingerprints + state application. We guide you through it.
                </div>
              </div>
            </div>` : "";

          await fetch(RESEND_URL, {
            method: "POST",
            headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              from: "APEX Financial <licensing@apex-financial.org>",
              to: [app.email],
              subject,
              html: `<div style="background:#030712;font-family:'DM Sans',sans-serif;max-width:600px;margin:0 auto;color:white;padding:32px">
                <div style="height:3px;background:linear-gradient(90deg,#22d3a5,#0ea5e9);margin-bottom:24px"></div>
                <h2 style="color:#22d3a5;margin:0 0 16px">${subject}</h2>
                <p style="color:rgba(255,255,255,0.8);line-height:1.6">Hey ${firstName},</p>
                <p style="color:rgba(255,255,255,0.8);line-height:1.6">${smsText.replace("APEX: ", "")}</p>
                ${licensingSteps}
                <a href="https://rebuild-brighten-sparkle.lovable.app/get-licensed" 
                   style="display:block;text-align:center;background:#22d3a5;color:#030712;padding:14px;border-radius:8px;font-weight:700;text-decoration:none;margin-top:24px">
                  CHECK YOUR PROGRESS →
                </a>
                <div style="height:3px;background:linear-gradient(90deg,#22d3a5,#0ea5e9);margin-top:24px"></div>
              </div>`,
            }),
          });
        } catch (e) { console.error("Email failed:", e); }
      }

      // Send SMS via existing function
      if (app.phone) {
        try {
          await fetch(`${supabaseUrl}/functions/v1/send-sms-auto-detect`, {
            method: "POST",
            headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({ to: app.phone, message: smsText }),
          });
        } catch (e) { console.error("SMS failed:", e); }
      }

      // Log to notification_log
      await supabase.from("notification_log").insert({
        notification_type: `licensing_day_${daysSinceContract}`,
        recipient_email: app.email,
        recipient_phone: app.phone,
        subject,
        body: smsText,
        application_id: app.id,
        channel: "email+sms",
        status: "sent",
      });

      sent++;
    }

    return new Response(JSON.stringify({ success: true, processed: unlicensedApps.length, sent }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
