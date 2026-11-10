import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { gateResend } from "../_shared/resend-gate.ts";
import { requireSendAuth } from "../_shared/require-send-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// WP5 (2026-11-10). This flow never ran from its DB trigger: trg_fn_agent_new_hire_flow sent {agent_id} while this
// function read {agentId}, so every run since April looked the agent up by `undefined` and 404'd, and
// run_automation_job recorded the queueing as "success". Fixed here AND gated:
//   * accepts agentId ?? agent_id;
//   * does nothing unless system_settings.new_hire_live_flow_enabled = 'true' (shipped 'false': Sam approves the copy
//     first, decision recorded in the WP5 receipts);
//   * claims the agent ATOMICALLY (production_unlocked_at is null -> now()), so a second call, a re-move into
//     in_field_training or a double click sends nothing;
//   * checks {error} on every write and reports a send only on a provider receipt;
//   * no longer forces onboarding_stage (the trigger fires on the stage move; the write was circular);
//   * no "You passed the course" claim (false for most recipients);
//   * no scheduled_tasks rows (nothing has ever read that table).
// The trigger is the single caller: TeamHierarchyManager and CourseProgress no longer invoke this directly.
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  // PL-LEAK-GATE (2026-10-25): service key always passes; otherwise a signed-in staff JWT.
  const leakGate = await requireSendAuth(req, { floor: "staff" });
  if (!leakGate.ok) return json({ ok: false, error: leakGate.error }, leakGate.status);

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "bad_json" }, 400);
  }
  const agentId = String(body.agentId ?? body.agent_id ?? "");
  if (!UUID_RE.test(agentId)) return json({ ok: false, error: "agentId (uuid) is required" }, 400);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const { data: flag, error: flagErr } = await supabase
      .from("system_settings").select("value").eq("key", "new_hire_live_flow_enabled").maybeSingle();
    if (flagErr) return json({ ok: false, error: `flag read failed: ${flagErr.message}` }, 500);
    if (String((flag as { value?: string } | null)?.value ?? "false").trim().toLowerCase() !== "true") {
      return json({ ok: true, skipped: "flag_off", note: "new_hire_live_flow_enabled is not 'true'; nothing was sent" });
    }

    // STEP 1: claim. Exactly one caller ever gets a row back.
    const { data: claimed, error: claimErr } = await supabase
      .from("agents")
      .update({ has_production_access: true, production_unlocked_at: new Date().toISOString() })
      .eq("id", agentId)
      .is("production_unlocked_at", null)
      .select("id, display_name, profile_id, invited_by_manager_id")
      .maybeSingle();
    if (claimErr) return json({ ok: false, error: `claim failed: ${claimErr.message}` }, 500);
    if (!claimed) {
      const { data: exists } = await supabase.from("agents").select("id").eq("id", agentId).maybeSingle();
      return exists ? json({ ok: true, skipped: "already_unlocked" }) : json({ ok: false, error: "Agent not found" }, 404);
    }

    const agent = claimed as { id: string; display_name: string | null; profile_id: string | null; invited_by_manager_id: string | null };
    const { data: profile, error: profileErr } = agent.profile_id
      ? await supabase.from("profiles").select("full_name, email, phone").eq("id", agent.profile_id).maybeSingle()
      : { data: null, error: null };
    if (profileErr) return json({ ok: false, error: `profile read failed: ${profileErr.message}` }, 500);
    const p = (profile ?? {}) as { full_name?: string | null; email?: string | null; phone?: string | null };
    const firstName = (p.full_name ?? agent.display_name ?? "").trim().split(/\s+/)[0] || "there";
    const results: Record<string, string> = { production_unlocked: "ok" };
    const resend = gateResend(new Resend(Deno.env.get("RESEND_API_KEY")!));

    // STEP 2: "You're live" email. Counted only on a provider id.
    if (p.email) {
      try {
        const r = await resend.emails.send({
          from: "Sam · Galaxy <sam@apex-financial.org>",
          to: p.email,
          subject: `${firstName}, your Galaxy dashboard is live`,
          html: `
            <div style="font-family:'DM Sans',sans-serif;max-width:560px;margin:0 auto;background:#030712;color:white">
              <div style="padding:40px 32px">
                <div style="font-size:11px;letter-spacing:4px;color:#22d3a5;text-transform:uppercase;margin-bottom:16px">GALAXY FINANCIAL</div>
                <h1 style="font-size:28px;font-weight:800;margin:0 0 16px;line-height:1.2">${firstName}, your production dashboard is live.</h1>
                <p style="color:rgba(255,255,255,0.75);line-height:1.8;margin:0 0 24px">
                  You're in field training now. Every deal you write shows on your dashboard and the leaderboard.
                  Your manager is the person to call with any question this week.
                </p>
                <a href="https://apex-financial.org/agent-dashboard" style="display:block;text-align:center;background:#22d3a5;color:#030712;padding:16px;border-radius:8px;font-weight:700;font-size:15px;text-decoration:none">
                  Open my dashboard
                </a>
                <p style="margin:24px 0 0;font-size:13px;color:#94a3b8">Sam, Managing Partner</p>
              </div>
            </div>`,
        });
        const id = (r as { data?: { id?: string } | null; error?: { message?: string } | null })?.data?.id;
        const err = (r as { error?: { message?: string } | null })?.error;
        results.welcome_email = id ? `sent:${id}` : `failed:${err?.message ?? "no provider id"}`;
      } catch (e) {
        results.welcome_email = `failed:${(e as Error).message}`;
      }
    } else {
      results.welcome_email = "skipped:no_email";
    }

    // STEP 3: text. The carrier gateway never returns a provider receipt; only an accepted gateway counts.
    if (p.phone) {
      try {
        const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-sms-auto-detect`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
          body: JSON.stringify({
            phone: p.phone,
            message: `${firstName}, your Galaxy dashboard is live. Log your first deal: apex-financial.org/agent-dashboard`,
            carrier: "auto",
          }),
        });
        // A non-JSON body is reported below as not_sent with the HTTP status, never as a send.
        const out = await res.json().catch(() => null) as { outcome?: string; carrierSelected?: string } | null; // empty-catch-allow:jsonparse-fallback
        results.sms = res.ok && out?.outcome === "sent" ? `gateway:${out.carrierSelected ?? "unknown"}` : `not_sent:${out?.outcome ?? res.status}`;
      } catch (e) {
        results.sms = `failed:${(e as Error).message}`;
      }
    } else {
      results.sms = "skipped:no_phone";
    }

    // STEP 4: leaderboard visibility row.
    const today = new Date().toISOString().split("T")[0];
    const { error: prodErr } = await supabase.from("daily_production").upsert(
      { agent_id: agentId, production_date: today, aop: 0, deals_closed: 0, presentations: 0 },
      { onConflict: "agent_id,production_date" },
    );
    results.leaderboard_row = prodErr ? `failed:${prodErr.message}` : "ok";

    // STEP 5: tell Sam and the hiring manager (invited_by_manager_id is an AGENT id).
    try {
      const r = await resend.emails.send({
        from: "Galaxy System <alerts@apex-financial.org>",
        to: "info@kingofsales.net",
        subject: `${firstName} is in field training: watch for the first deal`,
        html: `<p>${firstName} moved into field training. Production dashboard unlocked.</p>`,
      });
      results.sam_email = (r as { data?: { id?: string } | null })?.data?.id ? "sent" : "failed";
      if (agent.invited_by_manager_id) {
        const { data: mgr } = await supabase.from("agents").select("profile_id").eq("id", agent.invited_by_manager_id).maybeSingle();
        const mgrProfileId = (mgr as { profile_id?: string | null } | null)?.profile_id;
        const { data: mp } = mgrProfileId
          ? await supabase.from("profiles").select("email").eq("id", mgrProfileId).maybeSingle()
          : { data: null };
        const mgrEmail = (mp as { email?: string | null } | null)?.email;
        if (mgrEmail) {
          const r2 = await resend.emails.send({
            from: "Galaxy System <alerts@apex-financial.org>",
            to: mgrEmail,
            subject: `${firstName} is in field training on your team`,
            html: `<p>${firstName} moved into field training. Help them write their first deal this week.</p>`,
          });
          results.manager_email = (r2 as { data?: { id?: string } | null })?.data?.id ? "sent" : "failed";
        }
      }
    } catch (e) {
      results.notify = `failed:${(e as Error).message}`;
    }

    // STEP 6: team chat welcome (first name only; team channels carry celebrations, never contact details).
    const SAM_USER_ID = "4491dc82-a056-4fb3-ab38-b132afffb700";
    const { error: chatErr } = await supabase.from("team_chat_messages").insert({
      user_id: SAM_USER_ID,
      author_name: "Galaxy Pulse",
      body: `Welcome to field training, ${firstName}! Let's get them on the board this week.`,
    });
    results.team_chat = chatErr ? `failed:${chatErr.message}` : "ok";

    return json({ ok: true, results });
  } catch (error) {
    console.error("trigger-new-hire-flow error:", (error as Error).message);
    return json({ ok: false, error: (error as Error).message }, 500);
  }
});
