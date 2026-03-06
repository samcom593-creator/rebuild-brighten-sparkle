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
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

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

    // Calculate date ranges
    const in2Days = new Date(today);
    in2Days.setDate(today.getDate() + 2);
    const in2DaysStr = in2Days.toISOString().split("T")[0];

    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split("T")[0];

    // Fetch all applications with test_scheduled status
    const { data: apps, error } = await supabase
      .from("applications")
      .select("id, first_name, last_name, email, assigned_agent_id, test_scheduled_date")
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
      if (app.assigned_agent_id) {
        const { data: agent } = await supabase
          .from("agents")
          .select("invited_by_manager_id")
          .eq("id", app.assigned_agent_id)
          .single();

        if (agent?.invited_by_manager_id) {
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

      // Check if test is in 2 days (reminder)
      if (testDate === in2DaysStr || testDate === todayStr) {
        const isToday = testDate === todayStr;
        const subject = isToday
          ? `🎯 YOUR EXAM IS TODAY – Good Luck, ${app.first_name}!`
          : `📅 Exam Reminder – 2 Days Away, ${app.first_name}!`;

        const html = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #111; color: #fff; border-radius: 12px; overflow: hidden;">
            <div style="background: linear-gradient(135deg, #f59e0b, #ef4444); padding: 24px; text-align: center;">
              <h1 style="margin: 0; font-size: 22px; color: #fff;">${isToday ? "🎯 Exam Day!" : "📅 Exam in 2 Days!"}</h1>
            </div>
            <div style="padding: 24px;">
              <p style="font-size: 16px; margin-bottom: 16px;">Hi ${app.first_name},</p>
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

        if (app.email) {
          await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${RESEND_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              from: "APEX Financial <noreply@apex-financial.org>",
              to: [app.email],
              cc: ccList,
              subject,
              html,
            }),
          });
          remindersSent++;
          // Rate limit
          await new Promise(r => setTimeout(r, 1000));
        }
      }

      // Check if test was yesterday (follow-up)
      if (testDate === yesterdayStr) {
        const html = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #111; color: #fff; border-radius: 12px; overflow: hidden;">
            <div style="background: linear-gradient(135deg, #10b981, #059669); padding: 24px; text-align: center;">
              <h1 style="margin: 0; font-size: 22px; color: #fff;">🎉 How Did Your Exam Go?</h1>
            </div>
            <div style="padding: 24px;">
              <p style="font-size: 16px; margin-bottom: 16px;">Hi ${app.first_name},</p>
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

        if (app.email) {
          await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${RESEND_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              from: "APEX Financial <noreply@apex-financial.org>",
              to: [app.email],
              cc: ccList,
              subject: `🎉 Did You Pass? – Exam Follow-Up for ${app.first_name}`,
              html,
            }),
          });
          followUpsSent++;
          await new Promise(r => setTimeout(r, 1000));
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
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
