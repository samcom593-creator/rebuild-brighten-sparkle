// APEX autonomous optimization engine — master orchestrator.
//
// Dispatches five sub-bot audits on every invocation and writes their
// findings to bot_audits + bot_metrics_snapshots. Critical findings are
// mirrored into bot_alerts for real-time dispatch by apex-alert-dispatch.
//
// Sub-bots implemented here as methods, each with its own audit loop
// returning { audit_name, severity, finding_count, summary, detail, action,
// action_link }. Adding a new audit is just adding a method + listing it
// in the dispatch table at the bottom.
//
// Invocation:
//   POST /functions/v1/apex-audit-engine
//     { sub_bots?: string[], dry_run?: boolean }
//   no body → run all sub-bots in sequence (called from cron every 30 min)
//
// Rules that fire critical alerts are explicit — see queueAlert() calls.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const APP_BASE = "https://apex-financial.org";

// deploy trigger: b985c2e

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

interface AuditFinding {
  audit_name: string;
  severity: "info" | "warn" | "critical";
  finding_count: number;
  summary: string;
  detail?: unknown;
  action?: string;
  action_link?: string;
}

type Subbot = "agent_activation" | "recruiting" | "content" | "seminar" | "onboarding";

function daysAgoISO(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

function ymd(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

// ───────────────────────────────────────────────────────────────────────
// Sub-bot: agent_activation
// ───────────────────────────────────────────────────────────────────────
async function auditAgentActivation(): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];

  // Stuck in onboarding > 14d with zero deals → velocity killer
  const { data: stuck } = await supabase
    .from("agents")
    .select("id, created_at")
    .eq("is_inactive", true).eq("status", "active").eq("total_policies", 0);
  const now = Date.now();
  const longStuck = (stuck ?? []).filter((a: any) =>
    now - new Date(a.created_at).getTime() > 14 * 86_400_000
  );
  if (longStuck.length > 0) {
    findings.push({
      audit_name: "stuck_over_14d",
      severity: longStuck.length >= 20 ? "critical" : "warn",
      finding_count: longStuck.length,
      summary: `${longStuck.length} agents 14d+ in onboarding with 0 deals.`,
      detail: { agent_ids: longStuck.slice(0, 10).map((a: any) => a.id) },
      action: "Run onboarding-nudge-sweep or have manager make personal calls.",
      action_link: `${APP_BASE}/dashboard/inactive-agents`,
    });
  }

  // First-deal velocity: median days from created_at → first deal
  const { data: firstDeals } = await supabase
    .from("deals")
    .select("agent_id, created_at")
    .order("created_at", { ascending: true });
  const perAgentFirst = new Map<string, string>();
  for (const d of firstDeals ?? []) {
    if (!perAgentFirst.has((d as any).agent_id)) perAgentFirst.set((d as any).agent_id, (d as any).created_at);
  }
  const { data: activeAgents } = await supabase
    .from("agents")
    .select("id, created_at")
    .eq("status", "active");
  const velocityDays: number[] = [];
  for (const a of activeAgents ?? []) {
    const firstDeal = perAgentFirst.get((a as any).id);
    if (!firstDeal) continue;
    const days = (new Date(firstDeal).getTime() - new Date((a as any).created_at).getTime()) / 86_400_000;
    if (days >= 0) velocityDays.push(days);
  }
  if (velocityDays.length > 0) {
    velocityDays.sort((x, y) => x - y);
    const median = velocityDays[Math.floor(velocityDays.length / 2)];
    findings.push({
      audit_name: "median_time_to_first_deal",
      severity: median > 21 ? "warn" : "info",
      finding_count: Math.round(median),
      summary: `Median days from signup → first deal: ${Math.round(median)} (sample ${velocityDays.length}).`,
      detail: { p50: median, p25: velocityDays[Math.floor(velocityDays.length * 0.25)], p75: velocityDays[Math.floor(velocityDays.length * 0.75)] },
    });
  }

  // Producing ratio (active agents with deals / total active)
  const activeCount = activeAgents?.length ?? 0;
  const producing = (activeAgents ?? []).filter((a: any) => perAgentFirst.has(a.id)).length;
  if (activeCount > 0) {
    const ratio = producing / activeCount;
    findings.push({
      audit_name: "producing_ratio",
      severity: ratio < 0.25 ? "warn" : "info",
      finding_count: Math.round(ratio * 100),
      summary: `${producing}/${activeCount} active agents have closed ≥1 deal (${Math.round(ratio * 100)}%).`,
      detail: { producing, active_total: activeCount },
    });
  }

  return findings;
}

// ───────────────────────────────────────────────────────────────────────
// Sub-bot: recruiting
// ───────────────────────────────────────────────────────────────────────
async function auditRecruiting(): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];

  // Untouched licensed applicants → hot leads bleeding
  const { data: hotLicensed, count: hotCount } = await supabase
    .from("applications")
    .select("id, first_name, last_name, phone, email, created_at", { count: "exact" })
    .eq("status", "new")
    .eq("license_status", "licensed")
    .is("contacted_at", null)
    .is("last_contacted_at", null);
  const hot = hotCount ?? 0;
  if (hot > 0) {
    findings.push({
      audit_name: "licensed_hot_untouched",
      severity: hot >= 5 ? "critical" : "warn",
      finding_count: hot,
      summary: `${hot} licensed applicant${hot === 1 ? "" : "s"} still untouched (every one costs ~$1-3K/mo override).`,
      detail: { preview: (hotLicensed ?? []).slice(0, 5) },
      action: "Personally call the list; nudge-unworked-applications will SMS them at 6am CST if you don't.",
      action_link: `${APP_BASE}/dashboard/applicants?license=licensed&status=new&contacted=untouched`,
    });
  }

  // Apps submitted today
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const { count: appsToday } = await supabase
    .from("applications")
    .select("id", { count: "exact", head: true })
    .gte("created_at", todayStart.toISOString());
  findings.push({
    audit_name: "apps_today",
    severity: (appsToday ?? 0) === 0 ? "warn" : "info",
    finding_count: appsToday ?? 0,
    summary: `${appsToday ?? 0} new applications today.`,
  });

  // Manager-level staleness
  const { data: managerStale } = await supabase
    .from("applications")
    .select("hiring_manager_user_id, id")
    .eq("status", "new")
    .is("contacted_at", null);
  const byMgr: Record<string, number> = {};
  for (const a of managerStale ?? []) {
    const k = (a as any).hiring_manager_user_id ?? "unassigned";
    byMgr[k] = (byMgr[k] ?? 0) + 1;
  }
  const topMgr = Object.entries(byMgr).sort((a, b) => b[1] - a[1])[0];
  if (topMgr && topMgr[1] >= 15) {
    findings.push({
      audit_name: "manager_overloaded",
      severity: topMgr[1] >= 30 ? "critical" : "warn",
      finding_count: topMgr[1],
      summary: `Manager ${topMgr[0].slice(0, 8)}… has ${topMgr[1]} stale applications — bottleneck.`,
      detail: { top_3: Object.entries(byMgr).sort((a, b) => b[1] - a[1]).slice(0, 3) },
      action: "Re-route some to a less-loaded manager or auto-nudge.",
      action_link: `${APP_BASE}/dashboard/hiring-routing`,
    });
  }

  return findings;
}

// ───────────────────────────────────────────────────────────────────────
// Sub-bot: content
// ───────────────────────────────────────────────────────────────────────
async function auditContent(): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];

  // Content posted in last 24h (Sam's target: 4 videos/day)
  const { count: contentToday } = await supabase
    .from("content_library")
    .select("id", { count: "exact", head: true })
    .gte("created_at", daysAgoISO(1));
  const target = 4;
  findings.push({
    audit_name: "content_daily_count",
    severity: (contentToday ?? 0) < target ? "warn" : "info",
    finding_count: contentToday ?? 0,
    summary: `${contentToday ?? 0}/4 videos logged in last 24h.`,
    action: (contentToday ?? 0) < target
      ? `Record ${target - (contentToday ?? 0)} more pieces today — content is the top of the funnel.`
      : undefined,
  });

  // Unanswered inbound DMs
  const { count: unreplied } = await supabase
    .from("inbox_messages")
    .select("id", { count: "exact", head: true })
    .eq("direction", "inbound")
    .is("replied_at", null);
  if ((unreplied ?? 0) > 0) {
    findings.push({
      audit_name: "inbox_unreplied",
      severity: (unreplied ?? 0) >= 20 ? "warn" : "info",
      finding_count: unreplied ?? 0,
      summary: `${unreplied} inbound DM${unreplied === 1 ? "" : "s"} with no reply.`,
      action_link: `${APP_BASE}/dashboard/inbox`,
    });
  }

  return findings;
}

// ───────────────────────────────────────────────────────────────────────
// Sub-bot: seminar
// ───────────────────────────────────────────────────────────────────────
async function auditSeminar(): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];

  // seminar_registrations columns: attended (bool), seminar_date, registered_at, license_status
  const { data: regs, count: regCount } = await supabase
    .from("seminar_registrations")
    .select("id, attended, seminar_date, registered_at, license_status", { count: "exact" })
    .gte("registered_at", daysAgoISO(14));

  const total = regCount ?? 0;
  if (total === 0) {
    findings.push({
      audit_name: "seminar_registrations_14d",
      severity: "warn",
      finding_count: 0,
      summary: "No seminar registrations in the last 14 days.",
      action: "If seminars are still a live funnel, check promo. If not, deprioritize the tracking.",
    });
    return findings;
  }

  // Only count seminars that have already happened
  const now = Date.now();
  const past = (regs ?? []).filter((r: any) => r.seminar_date && new Date(r.seminar_date).getTime() < now);
  const attended = past.filter((r: any) => r.attended === true).length;
  const pastTotal = past.length;
  if (pastTotal === 0) {
    findings.push({
      audit_name: "seminar_attendance_14d",
      severity: "info",
      finding_count: total,
      summary: `${total} seminar registration${total === 1 ? "" : "s"} in last 14d (none past yet).`,
    });
    return findings;
  }
  const attendRate = attended / pastTotal;
  findings.push({
    audit_name: "seminar_attendance_14d",
    severity: attendRate < 0.4 ? "warn" : "info",
    finding_count: Math.round(attendRate * 100),
    summary: `${attended}/${pastTotal} past-seminar registrants showed up (${Math.round(attendRate * 100)}% attendance). ${total - pastTotal} upcoming.`,
    action: attendRate < 0.4 ? "Tighten reminder sequence (day-of SMS, 1h before)." : undefined,
  });

  return findings;
}

// ───────────────────────────────────────────────────────────────────────
// Sub-bot: onboarding
// ───────────────────────────────────────────────────────────────────────
async function auditOnboarding(): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];

  // getting_started_progress uses per-milestone boolean columns + current_stage.
  // Measure completion of the last step: closed_first_deal.
  const { data: progress, count } = await supabase
    .from("getting_started_progress")
    .select("agent_id, watched_welcome_video, signed_ica, received_license, closed_first_deal, current_stage, last_activity_at", { count: "exact" })
    .limit(500);

  const total = count ?? 0;
  const firstDealDone = (progress ?? []).filter((p: any) => p.closed_first_deal).length;
  if (total > 0) {
    const pct = Math.round((firstDealDone / total) * 100);
    findings.push({
      audit_name: "first_deal_completion",
      severity: pct < 30 ? "warn" : "info",
      finding_count: pct,
      summary: `${firstDealDone}/${total} agents have closed their first deal (${pct}%).`,
      action: pct < 30 ? "Heavy drop-off before first deal — check training + first-call support." : undefined,
      action_link: `${APP_BASE}/dashboard/getting-started`,
    });

    // Largest stage bucket (where people stall)
    const stageCounts: Record<string, number> = {};
    for (const p of progress ?? []) {
      const s = (p as any).current_stage || "unknown";
      stageCounts[s] = (stageCounts[s] ?? 0) + 1;
    }
    const top = Object.entries(stageCounts).sort((a, b) => b[1] - a[1])[0];
    if (top) {
      findings.push({
        audit_name: "onboarding_stage_top",
        severity: "info",
        finding_count: top[1],
        summary: `Most agents currently stalled at stage: ${top[0]} (${top[1]} agents).`,
        detail: { distribution: stageCounts },
      });
    }
  }

  // Automation health (automation_run_log uses triggered_at, not run_at)
  const { count: failures } = await supabase
    .from("automation_run_log")
    .select("id", { count: "exact", head: true })
    .eq("status", "failed")
    .gte("triggered_at", daysAgoISO(1));
  if ((failures ?? 0) > 0) {
    findings.push({
      audit_name: "automation_failures_24h",
      severity: (failures ?? 0) >= 5 ? "critical" : "warn",
      finding_count: failures ?? 0,
      summary: `${failures} automation failure${failures === 1 ? "" : "s"} in last 24h.`,
      action: "Check automation_run_log for specific job errors.",
      action_link: `${APP_BASE}/dashboard/automation-health`,
    });
  }

  return findings;
}

// ───────────────────────────────────────────────────────────────────────
// Alert dispatch queue
// ───────────────────────────────────────────────────────────────────────
async function queueAlert(sub_bot: Subbot, finding: AuditFinding) {
  const severity = finding.severity === "critical" ? "critical" : "warn";
  const subject = `[APEX ${severity.toUpperCase()}] ${sub_bot}: ${finding.audit_name}`;
  const sms = `${severity.toUpperCase()} ${sub_bot}: ${finding.summary}${finding.action ? " — " + finding.action : ""}`.slice(0, 155);
  const body = `
<p><strong>${finding.summary}</strong></p>
<p>Audit: <code>${finding.audit_name}</code> · count: <code>${finding.finding_count}</code></p>
${finding.action ? `<p><strong>Suggested fix:</strong> ${finding.action}</p>` : ""}
${finding.action_link ? `<p><a href="${finding.action_link}">Open in APEX →</a></p>` : ""}
${finding.detail ? `<pre style="background:#f3f4f6;padding:8px;border-radius:4px;font-size:12px">${JSON.stringify(finding.detail, null, 2).slice(0, 2000)}</pre>` : ""}
`;
  await supabase.from("bot_alerts").insert({
    source: "audit",
    event_type: `${sub_bot}.${finding.audit_name}`,
    severity,
    subject,
    body,
    sms_body: sms,
    action_link: finding.action_link ?? null,
    channels: severity === "critical" ? ["email", "sms"] : ["email"],
  });
}

// ───────────────────────────────────────────────────────────────────────
// Metrics snapshot — daily, keyed (snapshot_date, metric_key)
// ───────────────────────────────────────────────────────────────────────
async function snapshot(metric_key: string, metric_value: number, sub_bot?: Subbot, details?: unknown) {
  await supabase.from("bot_metrics_snapshots").upsert({
    snapshot_date: ymd(),
    metric_key,
    metric_value,
    sub_bot: sub_bot ?? null,
    details: details ?? null,
  }, { onConflict: "snapshot_date,metric_key" });
}

// ───────────────────────────────────────────────────────────────────────
// Dispatch
// ───────────────────────────────────────────────────────────────────────
const DISPATCH: Record<Subbot, () => Promise<AuditFinding[]>> = {
  agent_activation: auditAgentActivation,
  recruiting: auditRecruiting,
  content: auditContent,
  seminar: auditSeminar,
  onboarding: auditOnboarding,
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  let body: { sub_bots?: Subbot[]; dry_run?: boolean } = {};
  try { body = await req.json(); } catch { /* empty */ }

  const subbots: Subbot[] = body.sub_bots ?? (Object.keys(DISPATCH) as Subbot[]);
  const dry = body.dry_run === true;

  const allFindings: Record<string, AuditFinding[]> = {};
  const snapshotTargets: Array<{ key: string; value: number; sub_bot: Subbot }> = [];

  for (const sb of subbots) {
    const fn = DISPATCH[sb];
    if (!fn) continue;
    try {
      const findings = await fn();
      allFindings[sb] = findings;

      if (!dry) {
        for (const f of findings) {
          await supabase.from("bot_audits").insert({
            sub_bot: sb,
            audit_name: f.audit_name,
            severity: f.severity,
            finding_count: f.finding_count,
            summary: f.summary,
            detail: f.detail ?? null,
            action: f.action ?? null,
            action_link: f.action_link ?? null,
          });
          snapshotTargets.push({ key: `${sb}.${f.audit_name}`, value: f.finding_count, sub_bot: sb });
          if (f.severity === "warn" || f.severity === "critical") {
            await queueAlert(sb, f);
          }
        }
      }
    } catch (e: any) {
      allFindings[sb] = [{
        audit_name: "audit_failed",
        severity: "warn",
        finding_count: 0,
        summary: `Sub-bot ${sb} threw: ${e?.message ?? String(e)}`,
      }];
    }
  }

  // Daily snapshots (idempotent per day)
  if (!dry) {
    for (const t of snapshotTargets) {
      await snapshot(t.key, t.value, t.sub_bot);
    }
  }

  return new Response(JSON.stringify({
    ok: true,
    mode: dry ? "dry_run" : "live",
    findings: allFindings,
  }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
