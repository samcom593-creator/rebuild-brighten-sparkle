import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));
const PORTAL_URL = "https://rebuild-brighten-sparkle.lovable.app/agent-portal";

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { reminderType } = await req.json();

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Get all "Live" agents (evaluated stage = active producers)
    const { data: liveAgents, error: agentsError } = await supabaseClient
      .from("agents")
      .select("id, user_id")
      .eq("status", "active")
      .eq("onboarding_stage", "evaluated")
      .eq("is_deactivated", false);

    if (agentsError) throw agentsError;
    if (!liveAgents?.length) {
      return new Response(
        JSON.stringify({ success: true, message: "No live agents to notify" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Calculate date in CST (America/Chicago) timezone
    const now = new Date();
    const cstFormatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Chicago",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const todayCST = cstFormatter.format(now);

    // For 10am reminder, check yesterday's production; otherwise check today's
    let targetDate = todayCST;
    if (reminderType === "10am") {
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      targetDate = cstFormatter.format(yesterday);
    }

    // Get agents who haven't filled in their numbers
    const { data: filledAgents } = await supabaseClient
      .from("daily_production")
      .select("agent_id")
      .eq("production_date", targetDate);

    const filledAgentIds = new Set(filledAgents?.map(f => f.agent_id) || []);
    const agentsNeedingReminder = liveAgents.filter(a => !filledAgentIds.has(a.id));

    if (!agentsNeedingReminder.length) {
      return new Response(
        JSON.stringify({ success: true, message: "All agents have filled their numbers" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── AUTO-MARK AS PAYING FOR LEADS ──────────────────────────────────
    if (reminderType === "840pm" || reminderType === "9pm") {
      const weekDay = now.getDay();
      const sundayOffset = weekDay;
      const sunday = new Date(now.getTime() - sundayOffset * 24 * 60 * 60 * 1000);
      const weekStart = cstFormatter.format(sunday);

      const markResults = await Promise.allSettled(
        agentsNeedingReminder.map(async (agent) => {
          await supabaseClient
            .from("lead_payment_tracking")
            .upsert(
              {
                agent_id: agent.id,
                week_start: weekStart,
                tier: "standard",
                paid: false,
                marked_at: new Date().toISOString(),
              },
              { onConflict: "agent_id,week_start,tier" }
            );
        })
      );
      console.log(`Auto-marked ${markResults.filter(r => r.status === "fulfilled").length} agents as paying for leads`);
    }

    // BATCH: Fetch all profiles in one query
    const userIds = agentsNeedingReminder.map(a => a.user_id).filter(Boolean);
    const { data: profiles } = await supabaseClient
      .from("profiles")
      .select("user_id, full_name, email")
      .in("user_id", userIds);

    const profileMap = new Map(profiles?.map(p => [p.user_id, p]) || []);

    // ── SEND PUSH NOTIFICATIONS ────────────────────────────────────────
    const pushTitleByType: Record<string, string> = {
      "10am": "☀️ Log yesterday's numbers!",
      "4pm": "📊 Log your numbers!",
      "6pm": "⏰ Log your numbers now!",
      "7pm": "⏰ Log your numbers now!",
      "840pm": "🚨 Log numbers NOW or you're marked as paying for leads!",
      "9pm": "🚨 FINAL: Log numbers before midnight!",
    };

    const pushBodyByType: Record<string, string> = {
      "10am": "Start your day right — log yesterday's production.",
      "4pm": "End of day approaching. Take 30 seconds to log.",
      "6pm": "Only a few hours left! Don't miss today.",
      "7pm": "Only a few hours left! Don't miss today.",
      "840pm": "You haven't logged today's numbers. Do it NOW or you'll be marked as paying for leads this week.",
      "9pm": "LAST CHANCE! Log now before the day ends.",
    };

    let pushSent = 0;
    const pushUserIds = agentsNeedingReminder.map(a => a.user_id).filter(Boolean);
    if (pushUserIds.length > 0) {
      try {
        const pushRes = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-push-notification`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          },
          body: JSON.stringify({
            userIds: pushUserIds,
            title: pushTitleByType[reminderType] || "Log Your Numbers",
            body: pushBodyByType[reminderType] || "Log your daily production numbers.",
            url: "/agent-portal",
          }),
        });
        const pushData = await pushRes.json();
        pushSent = pushData.sent || 0;
      } catch (e) {
        console.error("Push batch error:", e);
      }
    }

    // ── SEND EMAILS ────────────────────────────────────────────────────
    const emailsSent: string[] = [];
    
    const subjectByType: Record<string, string> = {
      "10am": "☀️ Good morning! Log your numbers for yesterday",
      "4pm": "📊 Don't forget to log your numbers!",
      "6pm": "⏰ Time is running out - log your numbers now!",
      "7pm": "⏰ Time is running out - log your numbers now!",
      "840pm": "🚨 LOG YOUR NUMBERS NOW — or you're marked as paying for leads!",
      "9pm": "🚨 FINAL REMINDER: Log your numbers before midnight!",
    };

    const urgencyByType: Record<string, string> = {
      "10am": "Good morning! Start your day right by logging yesterday's production numbers.",
      "4pm": "End of day is approaching - take a moment to log your production.",
      "6pm": "Only a few hours left! Don't miss today's numbers.",
      "7pm": "Only a few hours left! Don't miss today's numbers.",
      "840pm": "⚠️ You haven't logged your numbers yet today. If you don't log them before midnight, you will be marked as PAYING FOR LEADS this week.",
      "9pm": "LAST CHANCE! Log your numbers now before the day ends.",
    };

    const urgencyColorByType: Record<string, string> = {
      "10am": "#3b82f6",
      "4pm": "#14b8a6",
      "6pm": "#f59e0b",
      "7pm": "#f59e0b",
      "840pm": "#ef4444",
      "9pm": "#ef4444",
    };

    const BATCH_SIZE = 10;
    for (let i = 0; i < agentsNeedingReminder.length; i += BATCH_SIZE) {
      const batch = agentsNeedingReminder.slice(i, i + BATCH_SIZE);
      
      const results = await Promise.allSettled(
        batch.map(async (agent) => {
          const profile = profileMap.get(agent.user_id);
          if (!profile?.email) return null;

          const firstName = profile.full_name?.split(" ")[0] || "Agent";
          const urgencyColor = urgencyColorByType[reminderType] || "#14b8a6";
          const isPayingWarning = reminderType === "840pm";

          await resend.emails.send({
            from: "APEX Financial Empire <notifications@apex-financial.org>",
            to: [profile.email],
            subject: subjectByType[reminderType] || "Log Your Daily Numbers",
            html: `
              <!DOCTYPE html>
              <html>
              <head>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
              </head>
              <body style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; padding: 0; background-color: #0a0f1a;">
                <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
                  <div style="background: linear-gradient(135deg, #0d1526 0%, #1a2a4a 100%); border-radius: 16px; padding: 40px; border: 1px solid ${urgencyColor}40;">
                    
                    <h1 style="color: ${urgencyColor}; font-size: 24px; margin: 0 0 20px 0;">
                      Hey ${firstName}! 👋
                    </h1>
                    
                    <p style="color: ${urgencyColor}; font-size: 16px; font-weight: bold; margin: 0 0 16px 0;">
                      ${urgencyByType[reminderType]}
                    </p>
                    
                    ${isPayingWarning ? `
                    <div style="background: #ef444420; border: 1px solid #ef4444; border-radius: 8px; padding: 16px; margin: 0 0 24px 0;">
                      <p style="color: #fca5a5; font-size: 14px; font-weight: bold; margin: 0;">
                        ⚠️ CONSEQUENCE: Agents who don't log their numbers are automatically marked as paying for leads for the current week. Log now to avoid this.
                      </p>
                    </div>
                    ` : ''}
                    
                    <p style="color: #e2e8f0; font-size: 16px; line-height: 1.8; margin: 0 0 24px 0;">
                      Your daily production numbers haven't been logged yet. Take a minute to update your stats so we can track your progress and celebrate your wins!
                    </p>
                    
                    <div style="text-align: center; margin: 32px 0;">
                      <a href="${PORTAL_URL}" style="display: inline-block; background: linear-gradient(135deg, ${urgencyColor} 0%, ${urgencyColor}dd 100%); color: #0a0f1a; text-decoration: none; padding: 16px 40px; border-radius: 8px; font-weight: bold; font-size: 16px;">
                        Log My Numbers Now →
                      </a>
                    </div>
                    
                    <p style="color: #94a3b8; font-size: 14px; text-align: center;">
                      It only takes 30 seconds!
                    </p>
                    
                    <div style="border-top: 1px solid rgba(148, 163, 184, 0.2); padding-top: 24px; margin-top: 24px;">
                      <p style="color: #64748b; font-size: 12px; margin: 0; text-align: center;">
                        APEX Financial Empire
                      </p>
                    </div>
                    
                  </div>
                </div>
              </body>
              </html>
            `,
          });

          return profile.email;
        })
      );

      results.forEach((result) => {
        if (result.status === "fulfilled" && result.value) {
          emailsSent.push(result.value);
        } else if (result.status === "rejected") {
          console.error("Email send failed:", result.reason);
        }
      });
    }

    console.log(`Sent ${emailsSent.length} emails + ${pushSent} push notifications (${reminderType})`);

    // ── ADMIN SUMMARY at 9PM ──────────────────────────────────────────
    if (reminderType === "9pm" && agentsNeedingReminder.length > 0) {
      try {
        // Build list of agent names who didn't log
        const missingNames = agentsNeedingReminder.map(a => {
          const profile = profileMap.get(a.user_id);
          return profile?.full_name || "Unknown Agent";
        });

        const adminEmail = "sam@apex-financial.org";
        const listHtml = missingNames.map(n => `<li style="color:#e2e8f0;font-size:14px;padding:4px 0;">${n}</li>`).join("");

        await resend.emails.send({
          from: "APEX Financial Empire <notifications@apex-financial.org>",
          to: [adminEmail],
          subject: `🚨 ${missingNames.length} agents didn't log numbers today`,
          html: `
            <!DOCTYPE html>
            <html><head><meta charset="utf-8"></head>
            <body style="font-family:'Segoe UI',sans-serif;margin:0;padding:0;background:#0a0f1a;">
              <div style="max-width:600px;margin:0 auto;padding:40px 20px;">
                <div style="background:linear-gradient(135deg,#0d1526,#1a2a4a);border-radius:16px;padding:32px;border:1px solid #ef444440;">
                  <h1 style="color:#ef4444;font-size:20px;margin:0 0 16px;">Daily Numbers Report</h1>
                  <p style="color:#e2e8f0;font-size:16px;margin:0 0 16px;">
                    <strong>${missingNames.length} agent(s)</strong> did not submit their daily production numbers today:
                  </p>
                  <ul style="margin:0 0 24px;padding-left:20px;">${listHtml}</ul>
                  <div style="text-align:center;">
                    <a href="${PORTAL_URL}" style="display:inline-block;background:#ef4444;color:#fff;text-decoration:none;padding:12px 32px;border-radius:8px;font-weight:bold;font-size:14px;">View Dashboard →</a>
                  </div>
                  <div style="border-top:1px solid rgba(148,163,184,0.2);padding-top:16px;margin-top:24px;">
                    <p style="color:#64748b;font-size:12px;text-align:center;margin:0;">APEX Financial Empire — Admin Summary</p>
                  </div>
                </div>
              </div>
            </body></html>
          `,
        });

        // Also send SMS to admin
        try {
          await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-sms-auto-detect`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
            },
            body: JSON.stringify({
              phone: "", // Admin phone would go here, but email is primary
              message: `APEX: ${missingNames.length} agents didn't log numbers today: ${missingNames.slice(0, 5).join(", ")}${missingNames.length > 5 ? ` +${missingNames.length - 5} more` : ""}`,
            }),
          });
        } catch (smsErr) {
          console.error("Admin SMS failed:", smsErr);
        }

        console.log(`Admin summary sent: ${missingNames.length} agents missing numbers`);
      } catch (adminErr) {
        console.error("Failed to send admin summary:", adminErr);
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        reminderType,
        message: `Sent ${emailsSent.length} emails + ${pushSent} push notifications`,
        emailsSent,
        pushSent,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Error in notify-fill-numbers:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
};

serve(handler);
