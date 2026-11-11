import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { gateResend } from "../_shared/resend-gate.ts";
import { RECRUIT_REPLY_TO } from "../_shared/reply-to.ts";
import { restartMarker, slotVerdict } from "../_shared/cron-schedule.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface HealthResult {
  service: string;
  status: "healthy" | "degraded" | "down";
  responseTime: number;
  message: string;
  autoFixed?: boolean;
  requiresAction?: boolean;
  actionRequired?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const results: HealthResult[] = [];
  const criticalIssues: string[] = [];
  const autoFixed: string[] = [];

  // ─── CHECK 1: Database connectivity ───
  try {
    const start = Date.now();
    const { error } = await supabase.from("agents").select("id").limit(1);
    const ms = Date.now() - start;
    if (error) throw error;
    results.push({
      service: "Database",
      status: ms > 2000 ? "degraded" : "healthy",
      responseTime: ms,
      message: ms > 2000 ? `Slow response: ${ms}ms` : `${ms}ms`,
    });
  } catch (err) {
    results.push({ service: "Database", status: "down", responseTime: 0, message: String(err), requiresAction: true, actionRequired: "Check database for outages" });
    criticalIssues.push("Database is down");
  }

  // ─── CHECK 2: Email delivery (Resend) ───
  try {
    const start = Date.now();
    const { data } = await supabase
      .from("notification_log")
      .select("created_at, status")
      .eq("status", "sent")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const ms = Date.now() - start;
    const lastEmailHours = data ? (Date.now() - new Date(data.created_at).getTime()) / 3600000 : 999;

    if (lastEmailHours > 25) {
      results.push({ service: "Email (Resend)", status: "degraded", responseTime: ms, message: `No emails sent in ${Math.round(lastEmailHours)}hrs`, requiresAction: true, actionRequired: "Check RESEND_API_KEY secret" });
      criticalIssues.push("No emails sent in 25+ hours");
    } else {
      results.push({ service: "Email (Resend)", status: "healthy", responseTime: ms, message: `Last sent ${Math.round(lastEmailHours)}hrs ago` });
    }
  } catch (err) {
    results.push({ service: "Email (Resend)", status: "down", responseTime: 0, message: String(err), requiresAction: true });
  }

  // ─── CHECK 3: SMS Gateway ───
  try {
    const { data } = await supabase
      .from("notification_log")
      .select("created_at")
      .or("channel.eq.sms,channel.eq.sms-auto,notification_type.ilike.%sms%")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const lastSMSHours = data ? (Date.now() - new Date(data.created_at).getTime()) / 3600000 : 999;
    results.push({
      service: "SMS Gateway",
      status: lastSMSHours > 48 ? "degraded" : "healthy",
      responseTime: 0,
      message: lastSMSHours > 48 ? `No SMS in ${Math.round(lastSMSHours)}hrs` : `Last sent ${Math.round(lastSMSHours)}hrs ago`,
    });
  } catch (err) {
    results.push({ service: "SMS Gateway", status: "degraded", responseTime: 0, message: String(err) });
  }

  // ─── CHECK 4: retired (MP-ONBOARD-ANCHOR-PKG1, 2026-11-12) ───
  // This block used to email "Still interested in Galaxy Financial?" through
  // send-notification to any applicant 3+ days old with no logged contact, every
  // 15 minutes: no license check, no booking check, no quiet hours (sent at 01:05,
  // 05:35 and 23:50 Phoenix), no link, and a Reply-To that bounced. 28 sends in 30
  // days, 0 clicks; 3 of the last 7 went to licensed people asked whether they were
  // "still interested in getting licensed". The next-step ladder is the one applicant
  // sequence now (stage cadence + quiet hours + suppression gate), and people the
  // ladder has finished with sit in the owner queue (v_recruit_sla_queue). This
  // function sends nothing to applicants.

  // ─── CHECK 5: Agent production logging ───
  try {
    const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];
    const { data: activeAgents } = await supabase.from("agents").select("id").eq("is_deactivated", false).eq("onboarding_stage", "evaluated");
    const { data: todayLogs } = await supabase.from("daily_production").select("agent_id").eq("production_date", yesterday).gt("aop", 0);
    const loggedIds = new Set(todayLogs?.map(r => r.agent_id));
    const notLogged = activeAgents?.filter(a => !loggedIds.has(a.id)) || [];
    const pct = activeAgents?.length ? Math.round((loggedIds.size / activeAgents.length) * 100) : 0;

    results.push({
      service: "Production Logging",
      status: pct < 50 ? "degraded" : "healthy",
      responseTime: 0,
      message: `${loggedIds.size}/${activeAgents?.length || 0} agents logged yesterday (${pct}%)`,
      requiresAction: pct < 50,
      actionRequired: pct < 50 ? `${notLogged.length} agents haven't logged numbers` : undefined,
    });
  } catch (err) {
    results.push({ service: "Production Logging", status: "degraded", responseTime: 0, message: String(err) });
  }

  // ─── CHECK 6: Cron jobs running (re-fire a missed scheduled slot) ───
  // PL-WIB-HEALTH-NO-FIRE (2026-10-21): this used to POST an automation whenever
  // its last automation_runs row was >26h old, without asking whether its cron
  // was on. All four crons it watched were active=false, so this check WAS
  // their schedule. It re-ran the licensing drip Sam turned off on 10-14 (127
  // sweeps since May) and the legacy send-numbers-reminder retired on 08-25 for
  // numbers-reminder (84 runs, a second reminder on the same day). It now fires
  // only an automation whose cron is on. A disabled cron is a decision, not an
  // outage, and a cron state it cannot read never fires anything. The legacy
  // "Numbers Reminder" entry is gone: numbers-reminder owns that job and does
  // not write automation_runs, so watching it here could only re-fire the
  // retired sender.
  // PL-WIB-HEALTH-SLOT (same day): a fixed 26h bar on a cron that IS on still
  // added runs the schedule leaves out. The digest is '0 13 * * 1-6', so
  // Saturday 13:00 + 26h fired a Sunday digest to every manager each week. It
  // now re-fires only when the cron's last scheduled slot is 2h old with no run
  // (_shared/cron-schedule.ts), and at most once per slot: the marker it writes
  // to auto_fixed is read back before firing, so a function that never logs a
  // run cannot make it fire every 15 minutes.
  try {
    // WP4 (2026-11-10): "Licensing Sequences" is gone from this list. Its cron
    // (apex-licensing-sequences) posted to send-bulk-unlicensed-outreach while
    // this entry re-fired send-licensing-sequence, so the check named one
    // endpoint and could fire another; the drip is off by Sam's 10-14 decision
    // and WP4 deleted the cron. Recruit sequences are graded by
    // public.v_recruit_sequence_health (apex-doctor #45) instead.
    const cronChecks = [
      { name: "Manager Daily Digest", endpoint: "manager-daily-digest", jobname: "apex-manager-daily-digest" },
      { name: "Daily Churn Check", endpoint: "check-churn-risk", jobname: "apex-daily-churn-check" },
    ];
    const { data: cronRows, error: cronErr } = await supabase.rpc("fn_cron_jobs_schedule", {
      p_jobnames: cronChecks.map((c) => c.jobname),
    });
    const cronByName = new Map<string, { active: boolean; schedule: string | null; timezone: string | null }>(
      ((cronRows ?? []) as { jobname: string; active: boolean; schedule: string | null; timezone: string | null }[])
        .map((r) => [r.jobname, { active: r.active === true, schedule: r.schedule, timezone: r.timezone }]),
    );
    for (const check of cronChecks) {
      if (cronErr || !Array.isArray(cronRows)) {
        results.push({
          service: `Cron: ${check.name}`,
          status: "degraded",
          responseTime: 0,
          message: `Could not read cron state (${cronErr?.message ?? "no rows"}); not auto-fired`,
        });
        continue;
      }
      const cron = cronByName.get(check.jobname);
      if (cron?.active !== true) {
        results.push({
          service: `Cron: ${check.name}`,
          status: "healthy",
          responseTime: 0,
          message: `Schedule off (${check.jobname} ${cron ? "disabled" : "not scheduled"}); not auto-fired`,
        });
        continue;
      }
      const { data, error: runErr } = await supabase
        .from("automation_runs")
        .select("ran_at, status")
        .eq("automation_name", check.name)
        .order("ran_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (runErr) {
        results.push({
          service: `Cron: ${check.name}`,
          status: "degraded",
          responseTime: 0,
          message: `Could not read automation_runs (${runErr.message}); not auto-fired`,
        });
        continue;
      }

      const now = new Date();
      const lastRunAt = data ? new Date(data.ran_at) : null;
      const hoursAgo = lastRunAt ? (now.getTime() - lastRunAt.getTime()) / 3600000 : null;
      const lastRan = hoursAgo === null ? "never ran" : `last ran ${Math.round(hoursAgo)}hrs ago`;
      const verdict = slotVerdict({ active: true, schedule: cron.schedule, timezone: cron.timezone, lastRunAt, now });

      if (verdict.kind === "ungraded") {
        results.push({
          service: `Cron: ${check.name}`,
          status: "degraded",
          responseTime: 0,
          message: `${verdict.reason}; ${lastRan}; not auto-fired`,
        });
        continue;
      }

      let restarted = false;
      let alreadyRestarted = false;
      let markerErr: string | null = null;
      if (verdict.fire) {
        const marker = restartMarker(check.name, verdict.slot);
        const { data: prior, error: priorErr } = await supabase
          .from("system_health_logs")
          .select("id")
          .gte("checked_at", verdict.slot.toISOString())
          .contains("auto_fixed", [marker])
          .limit(1);
        if (priorErr || !Array.isArray(prior)) {
          markerErr = priorErr?.message ?? "no rows";
        } else if (prior.length > 0) {
          alreadyRestarted = true;
        } else {
          try {
            const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/${check.endpoint}`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
              },
              body: "{}",
            });
            await res.body?.cancel();
            restarted = true;
            autoFixed.push(marker);
          } catch (restartErr) {
            console.error(`Auto-restart failed for ${check.endpoint}:`, restartErr);
          }
        }
      }

      const missed = verdict.fire;
      const down = missed && !restarted && !alreadyRestarted && !markerErr;
      results.push({
        service: `Cron: ${check.name}`,
        status: down ? "down" : missed ? "degraded" : data?.status === "error" ? "degraded" : "healthy",
        responseTime: 0,
        message: !missed
          ? `${lastRan[0].toUpperCase()}${lastRan.slice(1)} (${verdict.reason})`
          : restarted
            ? `Missed ${verdict.slot.toISOString()} slot (${lastRan}) — auto-restarted`
            : alreadyRestarted
              ? `Missed ${verdict.slot.toISOString()} slot (${lastRan}); already re-fired once for it, no run logged since`
              : markerErr
                ? `Missed ${verdict.slot.toISOString()} slot (${lastRan}); could not read prior restarts (${markerErr}), not auto-fired`
                : `Missed ${verdict.slot.toISOString()} slot (${lastRan}); restart failed`,
        autoFixed: restarted,
        requiresAction: down,
        actionRequired: down ? "Check cron schedule" : undefined,
      });
      if (down) criticalIssues.push(`Cron job not running: ${check.name}`);
    }
  } catch (err) {
    results.push({ service: "Cron Jobs", status: "degraded", responseTime: 0, message: String(err) });
  }

  // ─── CHECK 7: Storage buckets accessible ───
  try {
    const { data: buckets } = await supabase.storage.listBuckets();
    const requiredBuckets = ["avatars", "content-library"];
    for (const bucketName of requiredBuckets) {
      const exists = buckets?.find(b => b.name === bucketName);
      if (!exists) {
        await supabase.storage.createBucket(bucketName, { public: true });
        autoFixed.push(`Created missing storage bucket: ${bucketName}`);
        results.push({ service: `Storage: ${bucketName}`, status: "healthy", responseTime: 0, message: "Auto-created missing bucket", autoFixed: true });
      } else {
        results.push({ service: `Storage: ${bucketName}`, status: "healthy", responseTime: 0, message: "Accessible" });
      }
    }
  } catch (err) {
    results.push({ service: "Storage Buckets", status: "down", responseTime: 0, message: String(err), requiresAction: true });
    criticalIssues.push("Storage buckets inaccessible");
  }

  // ─── CHECK 8: Broken agent records ───
  try {
    const cutoff48h = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
    const { data: orphanAgents } = await supabase
      .from("agents")
      .select("id")
      .is("profile_id", null)
      .is("user_id", null)
      .eq("is_deactivated", false)
      .lt("created_at", cutoff48h);
    if (orphanAgents && orphanAgents.length > 0) {
      results.push({ service: "Agent Data Integrity", status: "degraded", responseTime: 0, message: `${orphanAgents.length} agents with no profile linked (>48h old)`, requiresAction: true, actionRequired: "Review agents table for orphaned records" });
    } else {
      results.push({ service: "Agent Data Integrity", status: "healthy", responseTime: 0, message: "All active agents have linked profiles" });
    }
  } catch (err) {
    results.push({ service: "Agent Data Integrity", status: "degraded", responseTime: 0, message: String(err) });
  }

  // ─── CHECK 9: Authentication ───
  try {
    const start = Date.now();
    const { error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1 });
    const ms = Date.now() - start;
    if (error) throw error;
    results.push({ service: "Authentication", status: ms > 3000 ? "degraded" : "healthy", responseTime: ms, message: `${ms}ms` });
  } catch (err) {
    results.push({ service: "Authentication", status: "down", responseTime: 0, message: String(err), requiresAction: true });
    criticalIssues.push("Authentication service is down");
  }

  // ─── CHECK 10: Realtime ───
  results.push({ service: "Realtime Subscriptions", status: "healthy", responseTime: 0, message: "Monitored via client" });

  // ─── SAVE RESULTS ───
  await supabase.from("system_health_logs").insert({
    checked_at: new Date().toISOString(),
    results,
    critical_count: criticalIssues.length,
    warning_count: results.filter(r => r.status === "degraded").length,
    auto_fixed: autoFixed,
    overall_status: criticalIssues.length > 0 ? "critical" : results.some(r => r.status === "degraded") ? "degraded" : "healthy",
  });

  // ─── ALERT SAM IF CRITICAL ───
  if (criticalIssues.length > 0) {
    try {
      const resendKey = Deno.env.get("RESEND_API_KEY");
      if (resendKey) {
        const resend = gateResend(new Resend(resendKey));
        await resend.emails.send({
          from: "Galaxy System <alerts@apex-financial.org>",
          to: "info@kingofsales.net",
          // MP-ONBOARD-ANCHOR-PKG1: alerts@ has no mailbox (550); a reply lands in the live inbox.
          reply_to: RECRUIT_REPLY_TO,
          subject: `🚨 ${criticalIssues.length} Critical System Issue${criticalIssues.length > 1 ? "s" : ""} Detected`,
          html: `
            <div style="font-family:sans-serif;max-width:560px;background:#030712;color:white;padding:32px;border-radius:12px">
              <div style="color:#ef4444;font-size:18px;font-weight:bold;margin-bottom:16px">🚨 System Alert</div>
              <p style="color:rgba(255,255,255,0.7);margin:0 0 16px">The following critical issues were detected:</p>
              ${criticalIssues.map(issue => `<div style="background:#ef444420;border:1px solid #ef444430;border-radius:8px;padding:10px 14px;margin-bottom:8px;color:#fca5a5">• ${issue}</div>`).join("")}
              ${autoFixed.length > 0 ? `<p style="color:rgba(255,255,255,0.7);margin:16px 0 8px">Auto-fixed:</p>${autoFixed.map(fix => `<div style="background:#22d3a520;border-radius:8px;padding:8px 12px;margin-bottom:6px;color:#22d3a5;font-size:13px">✓ ${fix}</div>`).join("")}` : ""}
              <a href="https://apex-financial.org/dashboard/system-health" style="display:block;text-align:center;background:#ef4444;color:white;padding:12px;border-radius:8px;text-decoration:none;font-weight:bold;margin-top:20px">View System Status →</a>
            </div>
          `
        });
      }
    } catch (emailErr) {
      console.error("Failed to send alert email:", emailErr);
    }

    try {
      await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-sms-auto-detect`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
        body: JSON.stringify({
          phone: Deno.env.get("SAM_PHONE_NUMBER") || "",
          message: `🚨 GALAXY ALERT: ${criticalIssues.length} critical issue(s). ${criticalIssues[0]}. Check system health page.`,
          carrier: "auto"
        })
      });
    } catch (smsErr) {
      console.error("Failed to send alert SMS:", smsErr);
    }
  }

  return new Response(JSON.stringify({
    overall: criticalIssues.length > 0 ? "critical" : results.some(r => r.status === "degraded") ? "degraded" : "healthy",
    critical: criticalIssues.length,
    warnings: results.filter(r => r.status === "degraded").length,
    autoFixed,
    results,
    checkedAt: new Date().toISOString(),
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
