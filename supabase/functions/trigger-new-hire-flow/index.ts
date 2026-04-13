import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { agentId, triggerType } = await req.json();
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const resend = new Resend(Deno.env.get("RESEND_API_KEY")!);

    const { data: agent } = await supabase
      .from("agents")
      .select("*, profiles(*)")
      .eq("id", agentId)
      .maybeSingle();

    if (!agent) {
      return new Response(JSON.stringify({ error: "Agent not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const firstName = agent.profiles?.full_name?.split(" ")[0] || "Agent";
    const email = agent.profiles?.email;
    const results: string[] = [];

    // STEP 1: Unlock production dashboard
    await supabase.from("agents").update({
      has_production_access: true,
      production_unlocked_at: new Date().toISOString(),
      onboarding_stage: "in_field_training",
    }).eq("id", agentId);
    results.push("production_unlocked");

    // STEP 2: Send "You're Live" email
    if (email) {
      try {
        await resend.emails.send({
          from: "Sam · APEX <sam@apex-financial.org>",
          to: email,
          subject: `${firstName}, You're Now Live — Start Logging Your Numbers`,
          html: `
            <div style="font-family:'DM Sans',sans-serif;max-width:560px;margin:0 auto;background:#030712;color:white">
              <div style="height:3px;background:linear-gradient(90deg,#22d3a5,#0ea5e9)"></div>
              <div style="padding:40px 32px">
                <div style="font-size:11px;letter-spacing:4px;color:#22d3a5;text-transform:uppercase;margin-bottom:16px">APEX FINANCIAL · YOU'RE LIVE</div>
                <h1 style="font-family:'Syne',sans-serif;font-size:32px;font-weight:800;margin:0 0 16px;line-height:1.1">
                  ${firstName}, your dashboard is ready.<br/>
                  <span style="color:#22d3a5">Time to make money.</span>
                </h1>
                <p style="color:rgba(255,255,255,0.7);line-height:1.8;margin:0 0 24px">
                  You've done the work. You passed the course. Now it's go time. Your production dashboard is live — every deal you close goes on the leaderboard in real time.
                </p>
                <div style="background:#0f172a;border-radius:12px;padding:20px;margin:0 0 24px">
                  <div style="font-size:13px;color:#64748b;margin-bottom:12px;text-transform:uppercase;letter-spacing:1px">Your first week targets:</div>
                  <div style="display:flex;gap:24px">
                    <div><div style="font-size:24px;font-weight:800;color:#22d3a5">5</div><div style="font-size:12px;color:#64748b">Presentations</div></div>
                    <div><div style="font-size:24px;font-weight:800;color:#22d3a5">2</div><div style="font-size:12px;color:#64748b">Deals</div></div>
                    <div><div style="font-size:24px;font-weight:800;color:#22d3a5">$3K</div><div style="font-size:12px;color:#64748b">ALP Target</div></div>
                  </div>
                </div>
                <a href="https://apex-financial.org/agent-dashboard" style="display:block;text-align:center;background:#22d3a5;color:#030712;padding:16px;border-radius:8px;font-family:'Syne',sans-serif;font-weight:700;font-size:15px;text-decoration:none;letter-spacing:0.5px">
                  OPEN MY DASHBOARD →
                </a>
                <p style="margin:24px 0 0;font-size:13px;color:#64748b">— Sam, Managing Partner<br/>PS — Log your first deal today. The leaderboard is watching.</p>
              </div>
              <div style="height:3px;background:linear-gradient(90deg,#22d3a5,#0ea5e9)"></div>
            </div>
          `,
        });
        results.push("welcome_email_sent");
      } catch (e) {
        console.error("Email send error:", e);
        results.push("welcome_email_failed");
      }
    }

    // STEP 3: Send SMS via auto-detect
    if (agent.profiles?.phone) {
      try {
        await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-sms-auto-detect`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          },
          body: JSON.stringify({
            phone: agent.profiles.phone,
            message: `🔥 ${firstName} — you're LIVE on APEX. Dashboard is ready. Log your first deal today: apex-financial.org/agent-dashboard`,
            carrier: "auto",
          }),
        });
        results.push("sms_sent");
      } catch {
        results.push("sms_failed");
      }
    }

    // STEP 4: Create initial production entry for leaderboard visibility
    const today = new Date().toISOString().split("T")[0];
    await supabase.from("daily_production").upsert(
      {
        agent_id: agentId,
        production_date: today,
        aop: 0,
        deals_closed: 0,
        presentations: 0,
      },
      { onConflict: "agent_id,production_date" }
    );
    results.push("added_to_leaderboard");

    // STEP 5: Notify Sam + manager
    try {
      await resend.emails.send({
        from: "APEX System <alerts@apex-financial.org>",
        to: "sam@apex-financial.org",
        subject: `🎯 ${firstName} is now LIVE — watch for their first deal`,
        html: `<p>${firstName} just went live on the platform. Production dashboard unlocked. Welcome email sent. They're on the leaderboard.</p>`,
      });

      if (agent.invited_by_manager_id) {
        const { data: manager } = await supabase
          .from("profiles")
          .select("email, full_name")
          .eq("user_id", agent.invited_by_manager_id)
          .maybeSingle();

        if (manager?.email) {
          await resend.emails.send({
            from: "APEX System <alerts@apex-financial.org>",
            to: manager.email,
            subject: `${firstName} is now live on your team`,
            html: `<p>Your agent ${firstName} has completed onboarding and is now live. Help them close their first deal this week.</p>`,
          });
        }
      }
      results.push("managers_notified");
    } catch {
      results.push("manager_notify_failed");
    }

    // STEP 6: Schedule 7-day check-ins
    await supabase.from("scheduled_tasks").insert([
      {
        task_type: "new_hire_day3_checkin",
        agent_id: agentId,
        scheduled_for: new Date(Date.now() + 3 * 86400000).toISOString(),
        status: "pending",
      },
      {
        task_type: "new_hire_week1_review",
        agent_id: agentId,
        scheduled_for: new Date(Date.now() + 7 * 86400000).toISOString(),
        status: "pending",
      },
    ]);
    results.push("checkins_scheduled");

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("trigger-new-hire-flow error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
