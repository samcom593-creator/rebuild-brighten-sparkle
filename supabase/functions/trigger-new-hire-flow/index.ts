import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
// 2.90.1 is the build proven to boot (2026-08-17 esm.sh boot-death incident); the bare @2 tag was unpinned.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";
import { BRAND_REPLY_TO, sendEmail } from "../_shared/email.ts";
import { requireSendAuth } from "../_shared/require-send-auth.ts";
import {
  firstNameOf,
  isSettled,
  legFromSend,
  managerEligible,
  managerNotice,
  runIsDone,
  staffNotice,
  welcomeEmail,
  type LegStatus,
} from "./legs.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAM_NOTICE_TO = "info@kingofsales.net";

// WP5 (2026-11-10). This flow never ran from its DB trigger: trg_fn_agent_new_hire_flow sent {agent_id} while this
// function read {agentId}, so every run since April looked the agent up by `undefined` and 404'd, and
// run_automation_job recorded the queueing as "success". Fixed here AND gated:
//   * accepts agentId ?? agent_id;
//   * does nothing unless system_settings.new_hire_live_flow_enabled = 'true' (shipped 'false': Sam approves the copy
//     first, decision recorded in the WP5 receipts);
//   * no longer forces onboarding_stage (the trigger fires on the stage move; the write was circular);
//   * no "You passed the course" claim (false for most recipients);
//   * no scheduled_tasks rows (nothing has ever read that table).
// The trigger is the single caller: TeamHierarchyManager and CourseProgress no longer invoke this directly.
//
// PKG2 (2026-11-12, MP-ONBOARD-ANCHOR) fixed the three defects found in review:
//   1. The team-chat post used user id 4491dc82, which does not exist in auth.users. It now posts as Sam's real login
//      (fn_recruit_sam_user_id), or not at all.
//   2. The manager email went to invited_by_manager_id with no check. A suspended, departed or deactivated manager
//      now gets nothing, and a suspended hire gets nothing at all.
//   3. The agent was claimed (production_unlocked_at) BEFORE the send, so a failed send was never retried. The claim
//      is now a 10-minute lease in new_hire_flow_runs; each leg's outcome is recorded there; a retry re-attempts only
//      the legs that did not land; production access is unlocked only when the welcome email reached a terminal
//      outcome (sent / refused / no address). fn_new_hire_flow_retry_sweep retries failed runs hourly, 3 attempts.
// Mail goes through _shared/email.ts sendEmail (suppression + non-routable gate, unsubscribe footer) with Reply-To
// info@kingofsales.net, the only inbox that exists. The text-message leg is gone: the carrier gateway has no working
// path and one touch per person per purpose is the email.
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

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
  let leaseHeld = false;

  try {
    const { data: flag, error: flagErr } = await supabase
      .from("system_settings").select("value").eq("key", "new_hire_live_flow_enabled").maybeSingle();
    if (flagErr) return json({ ok: false, error: `flag read failed: ${flagErr.message}` }, 500);
    if (String((flag as { value?: string } | null)?.value ?? "false").trim().toLowerCase() !== "true") {
      return json({ ok: true, skipped: "flag_off", note: "new_hire_live_flow_enabled is not 'true'; nothing was sent" });
    }

    const { data: agentRow, error: agentErr } = await supabase
      .from("agents")
      .select("id, user_id, display_name, profile_id, invited_by_manager_id, production_unlocked_at")
      .eq("id", agentId)
      .maybeSingle();
    if (agentErr) return json({ ok: false, error: `agent read failed: ${agentErr.message}` }, 500);
    if (!agentRow) return json({ ok: false, error: "Agent not found" }, 404);
    const agent = agentRow as {
      id: string; user_id: string | null; display_name: string | null; profile_id: string | null;
      invited_by_manager_id: string | null; production_unlocked_at: string | null;
    };
    if (agent.production_unlocked_at) return json({ ok: true, skipped: "already_unlocked" });

    // Standing rule: nobody with an open agent_access_suspensions row receives anything; a banned login neither.
    const { data: suspended, error: suspErr } = await supabase.rpc("fn_agent_is_suspended", { p_agent_id: agentId });
    if (suspErr) return json({ ok: false, error: `suspension check failed: ${suspErr.message}` }, 500);
    if (suspended === true) return json({ ok: true, skipped: "suspended" });
    if (agent.user_id) {
      const { data: banned, error: banErr } = await supabase.rpc("fn_user_login_blocked", { p_user_id: agent.user_id });
      if (banErr) return json({ ok: false, error: `ban check failed: ${banErr.message}` }, 500);
      if (banned === true) return json({ ok: true, skipped: "login_banned" });
    }

    // Lease, not claim: a failed send leaves the run open for a retry.
    const { data: claim, error: claimErr } = await supabase.rpc("fn_new_hire_flow_claim", { p_agent_id: agentId });
    if (claimErr) return json({ ok: false, error: `claim failed: ${claimErr.message}` }, 500);
    const lease = (claim ?? {}) as { claimed?: boolean; reason?: string; legs?: Record<string, LegStatus> };
    if (lease.claimed !== true) return json({ ok: true, skipped: lease.reason ?? "not_claimed" });
    leaseHeld = true;
    const prior: Record<string, LegStatus> = { ...(lease.legs ?? {}) };
    const legs: Record<string, LegStatus> = {};

    const { data: profile, error: profileErr } = agent.profile_id
      ? await supabase.from("profiles").select("full_name, email").eq("id", agent.profile_id).maybeSingle()
      : { data: null, error: null };
    if (profileErr) {
      await supabase.rpc("fn_new_hire_flow_finish", { p_agent_id: agentId, p_legs: {}, p_done: false, p_error: `profile read failed: ${profileErr.message}` });
      return json({ ok: false, error: `profile read failed: ${profileErr.message}` }, 500);
    }
    const p = (profile ?? {}) as { full_name?: string | null; email?: string | null };
    const firstName = firstNameOf(p.full_name, agent.display_name);

    // LEG 1: the hire's "your dashboard is live" email. Counted only on a provider id.
    if (!isSettled(prior.welcome_email)) {
      if (!p.email) {
        legs.welcome_email = "skipped:no_email";
      } else {
        const mail = welcomeEmail(firstName);
        legs.welcome_email = legFromSend(await sendEmail({
          to: p.email,
          subject: mail.subject,
          html: mail.html,
          text: mail.text,
          reply_to: BRAND_REPLY_TO,
          unsubscribe_token: agentId,
          tagName: "new-hire-live",
        }));
      }
    }

    // LEG 2: leaderboard visibility row (idempotent upsert).
    if (!isSettled(prior.leaderboard_row)) {
      const today = new Date().toISOString().split("T")[0];
      const { error: prodErr } = await supabase.from("daily_production").upsert(
        { agent_id: agentId, production_date: today, aop: 0, deals_closed: 0, presentations: 0 },
        { onConflict: "agent_id,production_date" },
      );
      legs.leaderboard_row = prodErr ? `failed:${prodErr.message}` : "ok";
    }

    // LEG 3: tell Sam.
    if (!isSettled(prior.sam_notice)) {
      const notice = staffNotice(firstName);
      legs.sam_notice = legFromSend(await sendEmail({
        to: SAM_NOTICE_TO, subject: notice.subject, html: notice.html, reply_to: BRAND_REPLY_TO, tagName: "new-hire-live-staff",
      }));
    }

    // LEG 4: tell the hiring manager, only an active, unsuspended one (invited_by_manager_id is an AGENT id).
    if (!isSettled(prior.manager_notice)) {
      if (!agent.invited_by_manager_id) {
        legs.manager_notice = "skipped:no_manager";
      } else {
        const { data: mgr, error: mgrErr } = await supabase
          .from("agents")
          .select("id, user_id, profile_id, status, is_deactivated, is_inactive")
          .eq("id", agent.invited_by_manager_id)
          .maybeSingle();
        const m = mgr as {
          id: string; user_id: string | null; profile_id: string | null; status: string | null;
          is_deactivated: boolean | null; is_inactive: boolean | null;
        } | null;
        const { data: mgrSuspended, error: mgrSuspErr } = m
          ? await supabase.rpc("fn_agent_is_suspended", { p_agent_id: m.id })
          : { data: null, error: null };
        const { data: mgrBanned, error: mgrBanErr } = m?.user_id
          ? await supabase.rpc("fn_user_login_blocked", { p_user_id: m.user_id })
          : { data: null, error: null };
        const { data: mp, error: mpErr } = m?.profile_id
          ? await supabase.from("profiles").select("email").eq("id", m.profile_id).maybeSingle()
          : { data: null, error: null };
        const readErr = mgrErr ?? mgrSuspErr ?? mgrBanErr ?? mpErr;
        if (readErr) {
          legs.manager_notice = `failed:${readErr.message}`;
        } else {
          const email = (mp as { email?: string | null } | null)?.email ?? null;
          const verdict = managerEligible(m ? { ...m, suspended: mgrSuspended === true || mgrBanned === true, email } : null);
          if (!verdict.ok) {
            legs.manager_notice = `skipped:${verdict.reason}`;
          } else if (email!.trim().toLowerCase() === SAM_NOTICE_TO) {
            legs.manager_notice = "skipped:same_as_sam_notice";
          } else {
            const notice = managerNotice(firstName);
            legs.manager_notice = legFromSend(await sendEmail({
              to: email!, subject: notice.subject, html: notice.html, reply_to: BRAND_REPLY_TO, tagName: "new-hire-live-manager",
            }));
          }
        }
      }
    }

    // LEG 5: team chat welcome (first name only), posted as Sam's REAL login, never a made-up id.
    if (!isSettled(prior.team_chat)) {
      const { data: samId, error: samErr } = await supabase.rpc("fn_recruit_sam_user_id");
      if (samErr || typeof samId !== "string" || !samId) {
        legs.team_chat = samErr ? `failed:${samErr.message}` : "skipped:no_poster";
      } else {
        const { error: chatErr } = await supabase.from("team_chat_messages").insert({
          user_id: samId,
          author_name: "Galaxy Pulse",
          body: `Welcome to field training, ${firstName}! Let's get them on the board this week.`,
        });
        legs.team_chat = chatErr ? `failed:${chatErr.message}` : "ok";
      }
    }

    const merged = { ...prior, ...legs };
    const done = runIsDone(merged);
    const failures = Object.entries(merged).filter(([, v]) => !isSettled(v)).map(([k, v]) => `${k}=${v}`);
    const { error: finishErr } = await supabase.rpc("fn_new_hire_flow_finish", {
      p_agent_id: agentId,
      p_legs: legs,
      p_done: done,
      p_error: failures.length ? failures.join("; ").slice(0, 500) : null,
    });
    if (finishErr) return json({ ok: false, error: `finish failed: ${finishErr.message}`, legs: merged }, 500);

    return json({ ok: done, done, retry: done ? null : "hourly via fn_new_hire_flow_retry_sweep (3 attempts)", legs: merged });
  } catch (error) {
    console.error("trigger-new-hire-flow error:", (error as Error).message);
    if (leaseHeld) {
      // release our lease so the hourly retry sweep can pick the run up
      const { error: releaseErr } = await supabase.rpc("fn_new_hire_flow_finish", {
        p_agent_id: agentId, p_legs: {}, p_done: false, p_error: (error as Error).message,
      });
      if (releaseErr) console.error("trigger-new-hire-flow lease release failed:", releaseErr.message);
    }
    return json({ ok: false, error: (error as Error).message }, 500);
  }
});
