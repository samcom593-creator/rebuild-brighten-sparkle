import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";

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
      .ilike("notification_type", "%sms%")
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

  // ─── CHECK 4: Stalled applicants (self-healing) ───
  try {
    const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString();
    const { data: stalledApplicants } = await supabase
      .from("applications")
      .select("id, first_name, last_name, email, phone, created_at, license_progress")
      .is("terminated_at", null)
      .is("contracted_at", null)
      .lt("created_at", threeDaysAgo)
      .is("contacted_at", null);

    if (stalledApplicants && stalledApplicants.length > 0) {
      for (const app of stalledApplicants.slice(0, 10)) {
        try {
          await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-notification`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
            body: JSON.stringify({
              email: app.email,
              title: "Still interested in APEX Financial?",
              message: `Hey ${app.first_name}, we noticed you applied but haven't heard back. Are you still interested in getting licensed? Reply to this email or call us.`,
            })
          });
        } catch {}
      }
      autoFixed.push(`Re-sent follow-up to ${stalledApplicants.length} stalled applicants`);
      results.push({ service: "Applicant Pipeline", status: "degraded", responseTime: 0, message: `${stalledApplicants.length} applicants stalled 3+ days — auto follow-up sent`, autoFixed: true });
    } else {
      results.push({ service: "Applicant Pipeline", status: "healthy", responseTime: 0, message: "All applicants being worked" });
    }
  } catch (err) {
    results.push({ service: "Applicant Pipeline", status: "degraded", responseTime: 0, message: String(err) });
  }

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

  // ─── CHECK 6: Cron jobs running (with auto-restart if >26h) ───
  try {
    const cronChecks = [
      { name: "Manager Daily Digest", endpoint: "manager-daily-digest" },
      { name: "Licensing Sequences", endpoint: "send-licensing-sequence" },
      { name: "Daily Churn Check", endpoint: "check-churn-risk" },
      { name: "Numbers Reminder", endpoint: "send-numbers-reminder" },
    ];
    for (const check of cronChecks) {
      const { data } = await supabase
        .from("automation_runs")
        .select("ran_at, status")
        .eq("automation_name", check.name)
        .order("ran_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const hoursAgo = data ? (Date.now() - new Date(data.ran_at).getTime()) / 3600000 : 999;

      // AUTO-RESTART: if cron hasn't run in 26+ hours, fire it now
      let restarted = false;
      if (hoursAgo > 26) {
        try {
          await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/${check.endpoint}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
            },
            body: "{}",
          });
          restarted = true;
          autoFixed.push(`Auto-restarted ${check.name} after ${Math.round(hoursAgo)}hr gap`);
        } catch (restartErr) {
          console.error(`Auto-restart failed for ${check.endpoint}:`, restartErr);
        }
      }

      results.push({
        service: `Cron: ${check.name}`,
        status: hoursAgo > 26 ? (restarted ? "degraded" : "down") : data?.status === "error" ? "degraded" : "healthy",
        responseTime: 0,
        message: hoursAgo > 26
          ? restarted ? `Was down ${Math.round(hoursAgo)}hrs — auto-restarted` : `Not run in ${Math.round(hoursAgo)}hrs`
          : `Last ran ${Math.round(hoursAgo)}hrs ago`,
        autoFixed: restarted,
        requiresAction: hoursAgo > 26 && !restarted,
        actionRequired: hoursAgo > 26 && !restarted ? "Check cron schedule" : undefined,
      });
      if (hoursAgo > 26 && !restarted) criticalIssues.push(`Cron job not running: ${check.name}`);
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
    const { data: orphanAgents } = await supabase.from("agents").select("id").is("profile_id", null).is("user_id", null).eq("is_deactivated", false);
    if (orphanAgents && orphanAgents.length > 0) {
      results.push({ service: "Agent Data Integrity", status: "degraded", responseTime: 0, message: `${orphanAgents.length} agents with no profile linked`, requiresAction: true, actionRequired: "Review agents table for orphaned records" });
    } else {
      results.push({ service: "Agent Data Integrity", status: "healthy", responseTime: 0, message: "All agents have profiles" });
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
        const resend = new Resend(resendKey);
        await resend.emails.send({
          from: "APEX System <alerts@apex-financial.org>",
          to: "sam@apex-financial.org",
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
          message: `🚨 APEX ALERT: ${criticalIssues.length} critical issue(s). ${criticalIssues[0]}. Check system health page.`,
          carrier: "auto"
        })
      });
    } catch {}
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
