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

    const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000).toISOString();

    // Get agents in first 90 days who are live
    const { data: newAgents } = await supabase
      .from("agents")
      .select("id, display_name, profile_id, created_at, invited_by_manager_id")
      .eq("onboarding_stage", "evaluated")
      .eq("is_deactivated", false)
      .gte("created_at", ninetyDaysAgo);

    if (!newAgents || newAgents.length === 0) {
      return new Response(JSON.stringify({ message: "No new agents to check" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let flagged = 0;
    for (const agent of newAgents) {
      const daysActive = Math.floor((Date.now() - new Date(agent.created_at).getTime()) / 86400000);
      if (daysActive < 14) continue; // Give them 2 weeks before flagging

      const { data: prod } = await supabase
        .from("daily_production")
        .select("aop, deals_closed")
        .eq("agent_id", agent.id);

      const totalALP = (prod || []).reduce((s, r) => s + Number(r.aop || 0), 0);
      const expectedALP = (daysActive / 30) * 3000;
      const performanceRatio = totalALP / Math.max(expectedALP, 1);

      if (performanceRatio < 0.3) {
        flagged++;

        // Get agent phone for SMS
        let phone: string | null = null;
        if (agent.profile_id) {
          const { data: profile } = await supabase
            .from("profiles")
            .select("phone")
            .eq("id", agent.profile_id)
            .single();
          phone = profile?.phone || null;
        }

        const firstName = agent.display_name?.split(" ")[0] || "Agent";

        // Send encouragement SMS
        if (phone) {
          await fetch(`${supabaseUrl}/functions/v1/send-sms-auto-detect`, {
            method: "POST",
            headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              to: phone,
              message: `APEX: ${firstName} — your manager wants to connect this week to help you hit your first big deal. What time works? Reply with your availability.`,
            }),
          }).catch(console.error);
        }

        // Notify manager
        if (agent.invited_by_manager_id && resendKey) {
          const { data: mgrAgent } = await supabase
            .from("agents")
            .select("profile_id")
            .eq("id", agent.invited_by_manager_id)
            .single();
          if (mgrAgent?.profile_id) {
            const { data: mgrProfile } = await supabase
              .from("profiles")
              .select("email")
              .eq("id", mgrAgent.profile_id)
              .single();
            if (mgrProfile?.email) {
              await fetch(RESEND_URL, {
                method: "POST",
                headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
                body: JSON.stringify({
                  from: "APEX Alerts <alerts@apex-financial.org>",
                  to: [mgrProfile.email],
                  subject: `⚠️ Early Performance Alert: ${agent.display_name}`,
                  html: `<p><strong>${agent.display_name}</strong> is at <strong>${Math.round(performanceRatio * 100)}%</strong> of expected pace after ${daysActive} days ($${Math.round(totalALP)} actual vs $${Math.round(expectedALP)} expected). Needs coaching.</p>`,
                }),
              }).catch(console.error);
            }
          }
        }

        // Log
        await supabase.from("notification_log").insert({
          notification_type: "early_performance_warning",
          agent_id: agent.id,
          subject: `Early performance alert: ${agent.display_name}`,
          body: `${Math.round(performanceRatio * 100)}% of expected pace after ${daysActive} days`,
          channel: "sms+email",
          status: "sent",
        });
      }
    }

    return new Response(JSON.stringify({ success: true, checked: newAgents.length, flagged }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
