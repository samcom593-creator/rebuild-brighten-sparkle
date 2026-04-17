import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function logRun(
  supabase: any,
  status: "success" | "error",
  affected: number,
  duration: number,
  errorMessage?: string,
) {
  try {
    await supabase.from("automation_runs").insert({
      automation_name: "Numbers Reminder",
      ran_at: new Date().toISOString(),
      status,
      agents_affected: affected,
      duration_ms: duration,
      error_message: errorMessage ?? null,
    });
  } catch (e) {
    console.error("Failed to log automation_run:", e);
  }
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const startedAt = Date.now();
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const resendKey = Deno.env.get("RESEND_API_KEY");
  const supabase = createClient(supabaseUrl, serviceKey);
  const resend = resendKey ? new Resend(resendKey) : null;

  let sent = 0;
  try {
    const today = new Date().toISOString().split("T")[0];

    // All active, evaluated agents
    const { data: activeAgents, error: agentsErr } = await supabase
      .from("agents")
      .select("id, user_id, display_name")
      .eq("is_deactivated", false)
      .eq("onboarding_stage", "evaluated");

    if (agentsErr) throw agentsErr;
    if (!activeAgents || activeAgents.length === 0) {
      await logRun(supabase, "success", 0, Date.now() - startedAt);
      return new Response(JSON.stringify({ sent: 0, total: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Pull profiles separately for safety
    const userIds = activeAgents.map((a: any) => a.user_id).filter(Boolean);
    const { data: profiles } = await supabase
      .from("profiles")
      .select("user_id, full_name, email, phone")
      .in("user_id", userIds.length ? userIds : ["00000000-0000-0000-0000-000000000000"]);
    const profileMap = new Map((profiles || []).map((p: any) => [p.user_id, p]));

    const { data: todayLogs } = await supabase
      .from("daily_production")
      .select("agent_id")
      .eq("production_date", today)
      .gt("aop", 0);

    const loggedIds = new Set((todayLogs || []).map((r: any) => r.agent_id));
    const notLogged = activeAgents.filter((a: any) => !loggedIds.has(a.id));

    for (const agent of notLogged) {
      const profile: any = profileMap.get(agent.user_id);
      const email = profile?.email;
      const phone = profile?.phone;
      const fullName = profile?.full_name || agent.display_name || "Agent";
      const firstName = fullName.split(" ")[0] || "Agent";

      if (resend && email) {
        try {
          await resend.emails.send({
            from: "Sam · APEX <notifications@apex-financial.org>",
            to: email,
            subject: `${firstName} — don't forget your numbers today`,
            html: `
              <div style="font-family:'DM Sans',Arial,sans-serif;max-width:500px;margin:0 auto;background:#030712;color:white;padding:32px;border-radius:12px">
                <div style="height:3px;background:linear-gradient(90deg,#22d3a5,#0ea5e9);margin-bottom:24px;border-radius:2px"></div>
                <h2 style="font-family:Syne,sans-serif;font-size:22px;margin:0 0 12px">Hey ${firstName}, log your numbers.</h2>
                <p style="color:rgba(255,255,255,0.7);line-height:1.7;margin:0 0 24px">
                  You haven't logged your production today. Your numbers matter — for your paycheck, your ranking, and your streak. Takes 60 seconds.
                </p>
                <a href="https://apex-financial.org/numbers" style="display:block;text-align:center;background:#22d3a5;color:#030712;padding:14px;border-radius:8px;font-family:Syne,sans-serif;font-weight:700;text-decoration:none">
                  LOG TODAY'S NUMBERS →
                </a>
                <p style="margin:20px 0 0;font-size:12px;color:#64748b;text-align:center">— Sam, APEX Financial</p>
                <div style="height:3px;background:linear-gradient(90deg,#22d3a5,#0ea5e9);margin-top:24px;border-radius:2px"></div>
              </div>
            `,
          });
        } catch (e) {
          console.error(`Email failed for ${email}:`, e);
        }
      }

      if (phone) {
        try {
          await fetch(`${supabaseUrl}/functions/v1/send-sms-auto-detect`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${serviceKey}`,
            },
            body: JSON.stringify({
              phone,
              message: `${firstName} — you haven't logged your numbers today. Takes 60 seconds: apex-financial.org/numbers`,
              carrier: "auto",
            }),
          });
        } catch (e) {
          console.error(`SMS failed for ${phone}:`, e);
        }
      }

      sent++;
    }

    await logRun(supabase, "success", sent, Date.now() - startedAt);
    return new Response(
      JSON.stringify({
        sent,
        total: activeAgents.length,
        notLogged: notLogged.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("send-numbers-reminder failed:", err, err?.stack);
    await logRun(supabase, "error", sent, Date.now() - startedAt, String(err?.message ?? err));
    return new Response(JSON.stringify({ error: String(err?.message ?? err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
