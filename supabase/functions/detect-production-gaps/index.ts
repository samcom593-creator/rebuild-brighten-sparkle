import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const RESEND_URL = "https://api.resend.com/emails";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const resendKey = Deno.env.get("RESEND_API_KEY");
    const supabase = createClient(supabaseUrl, serviceKey);

    const today = new Date().toISOString().split("T")[0];

    // Get all "live" agents (evaluated, not deactivated)
    const { data: liveAgents } = await supabase
      .from("agents")
      .select("id, display_name, profile_id, invited_by_manager_id, is_deactivated")
      .eq("onboarding_stage", "evaluated")
      .eq("is_deactivated", false);

    if (!liveAgents || liveAgents.length === 0) {
      return new Response(JSON.stringify({ message: "No live agents" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get today's loggers
    const { data: todayLoggers } = await supabase
      .from("daily_production")
      .select("agent_id")
      .eq("production_date", today)
      .gt("aop", 0);

    const loggerIds = new Set((todayLoggers || []).map(r => r.agent_id));

    // Find gaps
    const gaps = liveAgents.filter(a => !loggerIds.has(a.id));

    // For each gap agent, calculate consecutive missed days
    let alerts = 0;
    for (const agent of gaps) {
      // Get last production date
      const { data: lastProd } = await supabase
        .from("daily_production")
        .select("production_date")
        .eq("agent_id", agent.id)
        .gt("aop", 0)
        .order("production_date", { ascending: false })
        .limit(1);

      const lastDate = lastProd?.[0]?.production_date;
      const consecutiveMissed = lastDate
        ? Math.floor((Date.now() - new Date(lastDate).getTime()) / 86400000)
        : 999;

      // Get agent contact info
      let phone: string | null = null;
      let email: string | null = null;
      if (agent.profile_id) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("phone, email, full_name")
          .eq("id", agent.profile_id)
          .single();
        phone = profile?.phone || null;
        email = profile?.email || null;
      }

      const firstName = agent.display_name?.split(" ")[0] || "Agent";

      if (consecutiveMissed === 1 && phone) {
        // Gentle reminder
        await fetch(`${supabaseUrl}/functions/v1/send-sms-auto-detect`, {
          method: "POST",
          headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            to: phone,
            message: `APEX: ${firstName} — don't forget to log your numbers today! https://rebuild-brighten-sparkle.lovable.app/numbers`,
          }),
        }).catch(console.error);
        alerts++;
      } else if (consecutiveMissed === 2) {
        // SMS + manager notification
        if (phone) {
          await fetch(`${supabaseUrl}/functions/v1/send-sms-auto-detect`, {
            method: "POST",
            headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              to: phone,
              message: `APEX: ${firstName} — 2 days no numbers. Your manager has been notified. Log now: https://rebuild-brighten-sparkle.lovable.app/numbers`,
            }),
          }).catch(console.error);
        }

        // Notify manager
        if (agent.invited_by_manager_id && resendKey) {
          const { data: managerAgent } = await supabase
            .from("agents")
            .select("profile_id")
            .eq("id", agent.invited_by_manager_id)
            .single();
          if (managerAgent?.profile_id) {
            const { data: mgrProfile } = await supabase
              .from("profiles")
              .select("email")
              .eq("id", managerAgent.profile_id)
              .single();
            if (mgrProfile?.email) {
              await fetch(RESEND_URL, {
                method: "POST",
                headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
                body: JSON.stringify({
                  from: "APEX Alerts <alerts@apex-financial.org>",
                  to: [mgrProfile.email],
                  subject: `⚠️ ${agent.display_name} — 2 days no production`,
                  html: `<p>${agent.display_name} hasn't logged production in 2 days. Please reach out.</p>`,
                }),
              }).catch(console.error);
            }
          }
        }
        alerts++;
      } else if (consecutiveMissed >= 3) {
        // Alert Sam directly
        if (phone) {
          await fetch(`${supabaseUrl}/functions/v1/send-sms-auto-detect`, {
            method: "POST",
            headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              to: phone,
              message: `APEX: ${firstName} — ${consecutiveMissed} days without numbers. This affects your standing on the team. Log now.`,
            }),
          }).catch(console.error);
        }

        if (resendKey) {
          await fetch(RESEND_URL, {
            method: "POST",
            headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              from: "APEX Alerts <alerts@apex-financial.org>",
              to: ["sam@apex-financial.org"],
              subject: `🚨 PRODUCTION GAP: ${agent.display_name} — ${consecutiveMissed} consecutive days`,
              html: `<p><strong>${agent.display_name}</strong> has not logged production in <strong>${consecutiveMissed} consecutive days</strong>.</p>`,
            }),
          }).catch(console.error);
        }
        alerts++;
      }

      // Log to notification_log
      if (consecutiveMissed >= 1) {
        await supabase.from("notification_log").insert({
          notification_type: `production_gap_day_${consecutiveMissed}`,
          recipient_phone: phone,
          agent_id: agent.id,
          subject: `Production gap: ${consecutiveMissed} days`,
          body: `${agent.display_name} has not logged production in ${consecutiveMissed} days`,
          channel: "sms",
          status: "sent",
        });
      }
    }

    return new Response(JSON.stringify({ success: true, gaps: gaps.length, alerts }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
