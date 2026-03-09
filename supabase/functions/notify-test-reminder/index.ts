import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) {
      return new Response(JSON.stringify({ error: "RESEND_API_KEY not set" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminEmail = "sam@apex-financial.org";
    const today = new Date();
    const todayStr = today.toISOString().split("T")[0];

    const in2Days = new Date(today);
    in2Days.setDate(today.getDate() + 2);
    const in2DaysStr = in2Days.toISOString().split("T")[0];

    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split("T")[0];

    const { data: apps, error } = await supabase
      .from("applications")
      .select("id, first_name, last_name, email, phone, assigned_agent_id, test_scheduled_date")
      .eq("license_progress", "test_scheduled")
      .is("terminated_at", null)
      .not("test_scheduled_date", "is", null);

    if (error) {
      console.error("Error fetching applications:", error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let remindersSent = 0;
    let followUpsSent = 0;

    for (const app of apps || []) {
      const testDate = app.test_scheduled_date;
      if (!testDate) continue;

      const formattedDate = new Date(testDate + "T12:00:00").toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
      });

      // Resolve manager email
      let managerEmail = "";
      let managerAgentId: string | null = null;
      if (app.assigned_agent_id) {
        const { data: agent } = await supabase
          .from("agents")
          .select("invited_by_manager_id")
          .eq("id", app.assigned_agent_id)
          .single();

        if (agent?.invited_by_manager_id) {
          managerAgentId = agent.invited_by_manager_id;
          const { data: mgrAgent } = await supabase
            .from("agents")
            .select("user_id")
            .eq("id", agent.invited_by_manager_id)
            .single();

          if (mgrAgent?.user_id) {
            const { data: mgrProfile } = await supabase
              .from("profiles")
              .select("email")
              .eq("user_id", mgrAgent.user_id)
              .single();
            managerEmail = mgrProfile?.email || "";
          }
        }
      }

      const ccList = [adminEmail];
      if (managerEmail) ccList.push(managerEmail);

      const applicantName = `${app.first_name} ${app.last_name || ""}`.trim();

      // 2-day reminder or day-of reminder
      if (testDate === in2DaysStr || testDate === todayStr) {
        const isToday = testDate === todayStr;
        const subject = isToday
          ? `🎯 YOUR EXAM IS TODAY – Good Luck, ${app.first_name}!`
          : `📅 Exam Reminder – 2 Days Away, ${app.first_name}!`;

        const html = buildReminderHtml(app.first_name, formattedDate, isToday);

        if (app.email) {
          // Send email
          await sendEmail(RESEND_API_KEY, app.email, ccList, subject, html);
          remindersSent++;

          // Send push notification
          try {
            await fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
              method: "POST",
              headers: { Authorization: `Bearer ${supabaseKey}`, "Content-Type": "application/json" },
              body: JSON.stringify({
                email: app.email,
                title: isToday ? "🎯 Exam Day!" : "📅 Exam in 2 Days!",
                message: isToday
                  ? `Your licensing exam is TODAY! Bring your ID, arrive early, and crush it! 💪`
                  : `Your licensing exam is in 2 days on ${formattedDate}. Review your materials and get good rest!`,
              }),
            });
          } catch (e) { console.error("Push notification failed:", e); }

          // Send SMS on day-of
          if (isToday && app.phone) {
            try {
              await fetch(`${supabaseUrl}/functions/v1/send-sms-auto-detect`, {
                method: "POST",
                headers: { Authorization: `Bearer ${supabaseKey}`, "Content-Type": "application/json" },
                body: JSON.stringify({
                  phone: app.phone,
                  message: `🎯 ${app.first_name}, your licensing exam is TODAY! Bring your photo ID, arrive early, and stay calm. You've got this! – Apex Financial`,
                  applicationId: app.id,
                }),
              });
            } catch (e) { console.error("SMS failed:", e); }
          }

          await delay(1000);
        }
      }

      // Post-test follow-up (yesterday)
      if (testDate === yesterdayStr) {
        const html = buildFollowUpHtml(app.first_name, formattedDate);

        if (app.email) {
          await sendEmail(RESEND_API_KEY, app.email, ccList, `🎉 Did You Pass? – Exam Follow-Up for ${app.first_name}`, html);
          followUpsSent++;

          // Push notification to manager to check in
          if (managerEmail) {
            try {
              await fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
                method: "POST",
                headers: { Authorization: `Bearer ${supabaseKey}`, "Content-Type": "application/json" },
                body: JSON.stringify({
                  email: managerEmail,
                  title: "📋 Exam Follow-Up Needed",
                  message: `${applicantName}'s exam was yesterday. Check in to see if they passed!`,
                }),
              });
            } catch (e) { console.error("Manager push failed:", e); }
          }

          await delay(1000);
        }
      }
    }

    console.log(`Test reminders sent: ${remindersSent}, follow-ups sent: ${followUpsSent}`);

    return new Response(
      JSON.stringify({ success: true, remindersSent, followUpsSent }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Error in notify-test-reminder:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function sendEmail(apiKey: string, to: string, cc: string[], subject: string, html: string) {
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "APEX Financial <notifications@apex-financial.org>",
      to: [to],
      cc,
      subject,
      html,
    }),
  });
}

function buildReminderHtml(firstName: string, formattedDate: string, isToday: boolean): string {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #111; color: #fff; border-radius: 12px; overflow: hidden;">
      <div style="background: linear-gradient(135deg, #f59e0b, #ef4444); padding: 24px; text-align: center;">
        <h1 style="margin: 0; font-size: 22px; color: #fff;">${isToday ? "🎯 Exam Day!" : "📅 Exam in 2 Days!"}</h1>
      </div>
      <div style="padding: 24px;">
        <p style="font-size: 16px; margin-bottom: 16px;">Hi ${firstName},</p>
        <p style="font-size: 14px; line-height: 1.6; margin-bottom: 16px;">
          ${isToday ? "Your licensing exam is <strong>today</strong>!" : "Your licensing exam is coming up in <strong>2 days</strong>!"}
        </p>
        <div style="background: #1a1a2e; border: 1px solid #f59e0b; border-radius: 8px; padding: 16px; text-align: center; margin-bottom: 16px;">
          <p style="font-size: 20px; font-weight: bold; color: #f59e0b; margin: 0;">${formattedDate}</p>
        </div>
        <p style="font-size: 14px; line-height: 1.6;">
          ${isToday ? "Bring your photo ID, arrive early, stay calm, and crush it! 💪" : "Make sure to review your materials and get good rest. You've prepared for this!"}
        </p>
      </div>
      <div style="padding: 16px; text-align: center; border-top: 1px solid #222; font-size: 11px; color: #666;">
        Powered by Apex Financial
      </div>
    </div>
  `;
}

function buildFollowUpHtml(firstName: string, formattedDate: string): string {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #111; color: #fff; border-radius: 12px; overflow: hidden;">
      <div style="background: linear-gradient(135deg, #10b981, #059669); padding: 24px; text-align: center;">
        <h1 style="margin: 0; font-size: 22px; color: #fff;">🎉 How Did Your Exam Go?</h1>
      </div>
      <div style="padding: 24px;">
        <p style="font-size: 16px; margin-bottom: 16px;">Hi ${firstName},</p>
        <p style="font-size: 14px; line-height: 1.6; margin-bottom: 16px;">
          Your licensing exam was scheduled for <strong>${formattedDate}</strong>. We hope it went well!
        </p>
        <p style="font-size: 14px; line-height: 1.6; margin-bottom: 16px;">
          <strong>Did you pass?</strong> Reply to this email or let your manager know so we can update your status and get you started in the field!
        </p>
        <p style="font-size: 14px; line-height: 1.6;">
          If you didn't pass this time, don't worry – we'll help you schedule a retake. Most people pass on their second attempt!
        </p>
      </div>
      <div style="padding: 16px; text-align: center; border-top: 1px solid #222; font-size: 11px; color: #666;">
        Powered by Apex Financial
      </div>
    </div>
  `;
}
