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

function cleanPhone(phone: string): string {
  return phone.replace(/\D/g, "").slice(-10);
}

interface NudgeScheduleItem {
  day: number;
  type: string;
  stages: string[];
  emailSubject: string;
  emailBody: (name: string, stage: string) => string;
  smsBody: (name: string) => string;
}

const NUDGE_SCHEDULE: NudgeScheduleItem[] = [
  {
    day: 1, type: "course_push", stages: ["unlicensed", "pre_course"],
    emailSubject: "Step 1: Purchase Your Pre-Licensing Course Today",
    emailBody: (name) => `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        <h2 style="color:#059669;">Hey ${name},</h2>
        <p>Welcome to the APEX team! Your first step is to purchase and start the pre-licensing course.</p>
        <p>The course takes 2-4 weeks to complete. Agents who start in Week 1 get licensed <strong>3x faster</strong>.</p>
        <p style="margin:24px 0;"><a href="https://rebuild-brighten-sparkle.lovable.app/get-licensed" style="background:#059669;color:white;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:bold;">Start Your Course →</a></p>
        <p>Your first paycheck is closer than you think.</p>
        <p>— The APEX Team</p>
      </div>`,
    smsBody: (name) => `APEX: ${name}, your license is the only thing between you and your first paycheck. Step 1: buy the course today → apex-financial.org`,
  },
  {
    day: 2, type: "course_check", stages: ["unlicensed", "pre_course"],
    emailSubject: "Quick Check — Did You Get the Course?",
    emailBody: (name) => `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        <h2>Hey ${name},</h2>
        <p>Just checking in — did you purchase the pre-licensing course yet?</p>
        <p>If you need help or have questions about the process, reply to this email. We're here for you.</p>
        <p>— APEX Financial</p>
      </div>`,
    smsBody: (name) => `APEX: ${name}, did you purchase the course yet? Reply YES and we'll send you the study guide.`,
  },
  {
    day: 3, type: "day3_checkin", stages: ["unlicensed", "pre_course", "course_purchased"],
    emailSubject: "Day 3 Check-In — Where Are You At?",
    emailBody: (name, stage) => `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        <h2>Day 3 Check-In, ${name}</h2>
        ${stage === "course_purchased" 
          ? "<p>Great job getting the course! How's studying going? Try to knock out at least 2 hours today.</p>"
          : "<p>It's Day 3 and we haven't seen course activity yet. Don't let the momentum fade — agents who start this week get their license fastest.</p>"}
        <p style="margin:24px 0;"><a href="https://rebuild-brighten-sparkle.lovable.app/get-licensed" style="background:#059669;color:white;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:bold;">Check Your Progress →</a></p>
        <p>— APEX Financial</p>
      </div>`,
    smsBody: (name) => `APEX: Day 3 check-in ${name}. How's your progress? Stay consistent — 2-3 hours a day gets you licensed fast.`,
  },
  {
    day: 5, type: "urgency_push", stages: ["unlicensed", "pre_course"],
    emailSubject: "Don't Wait — Your Income Clock is Ticking",
    emailBody: (name) => `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        <h2>${name}, let's get moving</h2>
        <p>It's been 5 days since you joined APEX and we haven't seen course activity yet.</p>
        <p>Agents who start the course in Week 1 are licensed <strong>3x faster</strong> than those who wait.</p>
        <p>Every day you wait is a day without income. Let's change that today.</p>
        <p style="margin:24px 0;"><a href="https://rebuild-brighten-sparkle.lovable.app/get-licensed" style="background:#dc2626;color:white;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:bold;">Start Now →</a></p>
        <p>— Sam James, APEX Financial</p>
      </div>`,
    smsBody: (name) => `APEX: ${name}, agents who start the course in week 1 are licensed 3x faster. Don't wait. Start today.`,
  },
  {
    day: 7, type: "exam_schedule_push", stages: ["course_purchased"],
    emailSubject: "Time to Schedule Your Exam",
    emailBody: (name) => `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        <h2>Week 1 done, ${name}!</h2>
        <p>You should be halfway through the course by now. It's time to <strong>schedule your exam</strong>.</p>
        <p>Pro tip: Don't wait until you feel 100% ready. Having a date forces you to finish. Book it today and study toward the date.</p>
        <p>— APEX Financial</p>
      </div>`,
    smsBody: (name) => `APEX: ${name}, week 1 done. Time to book your exam. Don't wait until you finish — schedule it now and study toward the date.`,
  },
  {
    day: 10, type: "study_tip", stages: ["course_purchased"],
    emailSubject: "Study Tip from Sam",
    emailBody: (name) => `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        <h2>Study tip, ${name}</h2>
        <p>Schedule your exam before you feel ready. Having a date forces you to finish. Book it today.</p>
        <p>Most of our top agents passed on their first try by studying 2-3 hours daily for 2 weeks.</p>
        <p>You've got this.</p>
        <p>— Sam James</p>
      </div>`,
    smsBody: (name) => `APEX study tip from Sam: ${name}, schedule your exam before you feel ready. Having a date forces you to finish. Book it today.`,
  },
  {
    day: 14, type: "personal_followup", stages: ["unlicensed", "pre_course", "course_purchased"],
    emailSubject: "Still with us? I want to help.",
    emailBody: (name) => `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        <h2>Hey ${name},</h2>
        <p>It's been 2 weeks and I want to personally check in.</p>
        <p>I know life gets busy, but I also know you applied to APEX for a reason. Whatever's blocking you — schedule conflicts, course questions, financial concerns — I want to help remove it.</p>
        <p><strong>Reply to this email</strong> and let me know where you're at. I'm here for you.</p>
        <p>— Sam James<br/>Agency Director, APEX Financial</p>
      </div>`,
    smsBody: (name) => `APEX: ${name}, it's been 2 weeks. Still with us? Reply and let me know what's blocking you. I want to help. -Sam`,
  },
  {
    day: 21, type: "stall_warning", stages: ["unlicensed", "pre_course", "course_purchased"],
    emailSubject: "Your APEX journey — what's next?",
    emailBody: (name) => `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        <h2>${name},</h2>
        <p>It's been 3 weeks. Most agents who haven't scheduled their exam by day 21 end up taking 2-3 months. The ones who pass quickly all say the same thing: they just committed to a date even before they felt ready.</p>
        <p><strong>Book your exam today.</strong></p>
        <p>If your plans have changed, that's okay too — just let me know so we can update our records.</p>
        <p>— Sam James</p>
      </div>`,
    smsBody: (name) => `APEX: ${name}, day 21. Have you scheduled your exam yet? The agents ahead of you booked before they felt ready. Reply YES or NO -Sam`,
  },
  {
    day: 30, type: "month_checkin", stages: ["unlicensed", "pre_course", "course_purchased"],
    emailSubject: "One month. Still worth it?",
    emailBody: (name) => `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        <h2>${name}, one month in.</h2>
        <p>I still believe in you. But I need you to show me you believe in yourself.</p>
        <p>Reply to this email with your exam date. If you don't have one, reply <strong>"I need help"</strong> and I'll call you personally within 24 hours.</p>
        <p>— Sam James<br/>Managing Partner, APEX Financial</p>
      </div>`,
    smsBody: (name) => `APEX: ${name}, 30 days. Reply to Sam's email with your exam date or reply HELP for a personal call. -Sam`,
  },
  {
    day: 45, type: "last_call", stages: ["unlicensed", "pre_course", "course_purchased"],
    emailSubject: "Last call — are you in or out?",
    emailBody: (name) => `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        <h2>This is my last automated email, ${name}.</h2>
        <p>6 weeks. I've sent you everything you need. At this point the only thing between you and a license is a decision.</p>
        <p>Your teammates who started after you are already in the field closing deals. Are you in or out?</p>
        <p><strong>Reply and let me know.</strong></p>
        <p>— Sam James</p>
      </div>`,
    smsBody: (name) => `APEX: Last automated message ${name}. Reply YES to continue or we'll close your file. -Sam`,
  },
];

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const resendKey = Deno.env.get("RESEND_API_KEY");

    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

    const resend = resendKey ? new Resend(resendKey) : null;

    // Get all unlicensed, contracted, non-terminated applications
    const { data: unlicensed, error: fetchError } = await supabase
      .from("applications")
      .select("id, first_name, last_name, email, phone, license_progress, contracted_at, assigned_agent_id, license_status")
      .eq("license_status", "unlicensed")
      .not("contracted_at", "is", null)
      .is("terminated_at", null);

    if (fetchError) {
      console.error("Error fetching unlicensed applications:", fetchError);
      throw new Error(fetchError.message);
    }

    const now = new Date();
    const results: any[] = [];

    for (const app of unlicensed || []) {
      const contractedDate = new Date(app.contracted_at);
      const daysSinceContracted = Math.floor(
        (now.getTime() - contractedDate.getTime()) / 86400000
      );
      const stage = app.license_progress || "unlicensed";
      const firstName = app.first_name;

      // Determine urgency
      let urgency = "normal";
      if (daysSinceContracted > 21 && !["exam_passed", "test_scheduled", "finished_course"].includes(stage)) urgency = "critical";
      else if (daysSinceContracted > 14 && ["unlicensed", "pre_course"].includes(stage)) urgency = "high";
      else if (daysSinceContracted > 7 && ["unlicensed", "pre_course"].includes(stage)) urgency = "medium";

      // Find applicable nudges for today
      for (const nudge of NUDGE_SCHEDULE) {
        if (daysSinceContracted !== nudge.day) continue;
        if (!nudge.stages.includes(stage)) continue;

        // Check if already sent
        const { data: existing } = await supabase
          .from("licensing_nudges")
          .select("id")
          .eq("application_id", app.id)
          .eq("nudge_type", nudge.type)
          .eq("day_number", nudge.day)
          .limit(1);

        if (existing && existing.length > 0) continue;

        // Send email
        let emailSent = false;
        if (resend && app.email) {
          try {
            await resend.emails.send({
              from: "Apex Financial <notifications@apex-financial.org>",
              to: [app.email],
              subject: nudge.emailSubject,
              html: nudge.emailBody(firstName, stage),
            });
            emailSent = true;
            console.log(`Email sent to ${app.email}: ${nudge.type}`);
          } catch (e) {
            console.error(`Email failed for ${app.email}:`, e);
          }
        }

        // Send SMS via carrier gateway
        let smsSent = false;
        if (app.phone) {
          try {
            const smsResponse = await fetch(`${supabaseUrl}/functions/v1/send-sms-auto-detect`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${serviceKey}`,
              },
              body: JSON.stringify({
                phone: app.phone,
                message: nudge.smsBody(firstName),
              }),
            });
            smsSent = smsResponse.ok;
            if (smsSent) console.log(`SMS sent to ${app.phone}: ${nudge.type}`);
          } catch (e) {
            console.error(`SMS failed for ${app.phone}:`, e);
          }
        }

        // Log the nudge
        if (emailSent || smsSent) {
          await supabase.from("licensing_nudges").insert({
            application_id: app.id,
            nudge_type: nudge.type,
            day_number: nudge.day,
            channel: emailSent && smsSent ? "email+sms" : emailSent ? "email" : "sms",
          });
        }

        results.push({
          appId: app.id,
          name: `${firstName} ${app.last_name}`,
          stage,
          urgency,
          day: nudge.day,
          type: nudge.type,
          emailSent,
          smsSent,
        });
      }

      // Notify manager + Sam for critical cases (day 14+)
      if (urgency === "critical" && daysSinceContracted % 7 === 0) {
        // Check if we already sent a critical alert this week
        const weekAgo = new Date(now.getTime() - 7 * 86400000).toISOString();
        const { data: recentAlert } = await supabase
          .from("licensing_nudges")
          .select("id")
          .eq("application_id", app.id)
          .eq("nudge_type", "critical_alert")
          .gte("sent_at", weekAgo)
          .limit(1);

        if (!recentAlert || recentAlert.length === 0) {
          // Notify Sam
          if (resend) {
            await resend.emails.send({
              from: "Apex Financial <notifications@apex-financial.org>",
              to: ["sam@apex-financial.org"],
              subject: `🚨 Stalled Agent: ${firstName} ${app.last_name} — ${daysSinceContracted} days, stage: ${stage}`,
              html: `<p><strong>${firstName} ${app.last_name}</strong> has been contracted for ${daysSinceContracted} days and is still in the "${stage}" stage. Personal follow-up recommended.</p>
                     <p>Email: ${app.email}<br/>Phone: ${app.phone || "N/A"}</p>`,
            });
          }

          await supabase.from("licensing_nudges").insert({
            application_id: app.id,
            nudge_type: "critical_alert",
            day_number: daysSinceContracted,
            channel: "email",
          });
        }
      }
    }

    console.log(`Licensing checkups complete. Processed: ${results.length} nudges for ${unlicensed?.length || 0} applications.`);

    return new Response(
      JSON.stringify({ success: true, processed: results.length, total_unlicensed: unlicensed?.length || 0, results }),
      { headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: any) {
    console.error("Error in run-licensing-checkups:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
});
