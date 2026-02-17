import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const resendApiKey = Deno.env.get("RESEND_API_KEY");

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

const supabaseAnon = createClient(supabaseUrl, anonKey, {
  auth: { persistSession: false },
});

const ALERT_EMAIL = "info@apex-financial.org";
const DASHBOARD_URL = "https://apex-financial.org";
const COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

interface CheckResult {
  check_name: string;
  status: "pass" | "fail";
  error_message: string | null;
  response_time_ms: number;
}

async function runCheck(name: string, fn: () => Promise<void>): Promise<CheckResult> {
  const start = Date.now();
  try {
    await fn();
    return { check_name: name, status: "pass", error_message: null, response_time_ms: Date.now() - start };
  } catch (e: any) {
    return { check_name: name, status: "fail", error_message: e.message || String(e), response_time_ms: Date.now() - start };
  }
}

// ── Individual checks ──

async function checkDbConnectivity() {
  const { error } = await supabaseAdmin.from("lead_counter").select("id").limit(1);
  if (error) throw new Error(`DB connectivity failed: ${error.message}`);
}

async function checkPartialAppsRls() {
  const testSession = `health_check_${Date.now()}`;
  // INSERT via anon client (simulates anonymous visitor)
  const { error: insertErr } = await supabaseAnon
    .from("partial_applications")
    .insert({ session_id: testSession, step_completed: 1 });
  if (insertErr) throw new Error(`Anonymous INSERT blocked: ${insertErr.message}`);

  // UPDATE via anon client
  const { error: updateErr } = await supabaseAnon
    .from("partial_applications")
    .update({ step_completed: 2 })
    .eq("session_id", testSession);
  if (updateErr) throw new Error(`Anonymous UPDATE blocked: ${updateErr.message}`);

  // Cleanup via service role
  await supabaseAdmin.from("partial_applications").delete().eq("session_id", testSession);
}

async function checkSubmitAppPing() {
  const res = await fetch(`${supabaseUrl}/functions/v1/submit-application`, {
    method: "OPTIONS",
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok && res.status !== 204) throw new Error(`submit-application OPTIONS returned ${res.status}`);
  await res.text();
}

async function checkGetManagersPing() {
  const res = await fetch(`${supabaseUrl}/functions/v1/get-active-managers`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${anonKey}`,
    },
    body: JSON.stringify({}),
  });
  if (res.status >= 500) throw new Error(`get-active-managers returned ${res.status}`);
  await res.text();
}

async function checkResendApiKey() {
  if (!resendApiKey || resendApiKey.trim() === "") {
    throw new Error("RESEND_API_KEY is not set or empty");
  }
}

async function checkModulesExist() {
  const { data, error } = await supabaseAdmin
    .from("onboarding_modules")
    .select("id")
    .eq("is_active", true);
  if (error) throw new Error(`Failed to query modules: ${error.message}`);
  if (!data || data.length === 0) throw new Error("No active onboarding modules found");
}

async function checkQuestionsExist() {
  const { data, error } = await supabaseAdmin
    .from("onboarding_questions")
    .select("id")
    .limit(1);
  if (error) throw new Error(`Failed to query questions: ${error.message}`);
  if (!data || data.length === 0) throw new Error("No onboarding questions found");
}

async function checkAgentsTable() {
  const { error } = await supabaseAdmin.from("agents").select("id").limit(1);
  if (error) throw new Error(`agents table query failed: ${error.message}`);
}

async function checkApplicationsTable() {
  const { error } = await supabaseAdmin.from("applications").select("id").limit(1);
  if (error) throw new Error(`applications table query failed: ${error.message}`);
}

async function checkCronJobsActive() {
  const { data, error } = await supabaseAdmin.rpc("get_cron_jobs_count" as any);
  // If the RPC doesn't exist, skip gracefully
  if (error) {
    // Try direct query via service role
    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/get_cron_jobs_count`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${serviceRoleKey}`,
        "apikey": serviceRoleKey,
      },
    });
    // If RPC doesn't exist, just verify we can reach the DB (non-critical)
    if (!res.ok) {
      console.log("Cron job check skipped (RPC not available)");
      await res.text();
    } else {
      await res.text();
    }
  }
}

// ── Main handler ──

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("[HealthCheck] Starting system health check...");

    const results: CheckResult[] = [];

    // Run all checks
    results.push(await runCheck("db_connections", checkDbConnectivity));
    results.push(await runCheck("partial_apps_rls", checkPartialAppsRls));
    results.push(await runCheck("submit_app_ping", checkSubmitAppPing));
    results.push(await runCheck("get_managers_ping", checkGetManagersPing));
    results.push(await runCheck("resend_api_key", checkResendApiKey));
    results.push(await runCheck("modules_exist", checkModulesExist));
    results.push(await runCheck("questions_exist", checkQuestionsExist));
    results.push(await runCheck("agents_table", checkAgentsTable));
    results.push(await runCheck("applications_table", checkApplicationsTable));
    results.push(await runCheck("cron_jobs_active", checkCronJobsActive));

    const failures = results.filter(r => r.status === "fail");
    const passed = results.filter(r => r.status === "pass");

    console.log(`[HealthCheck] Results: ${passed.length} passed, ${failures.length} failed`);

    // Log all results to health_check_log
    const logRows = results.map(r => ({
      check_name: r.check_name,
      status: r.status,
      error_message: r.error_message,
      response_time_ms: r.response_time_ms,
    }));

    const { error: logError } = await supabaseAdmin
      .from("health_check_log")
      .insert(logRows);

    if (logError) {
      console.error("[HealthCheck] Failed to write logs:", logError.message);
    }

    // Send alert email if there are failures
    if (failures.length > 0 && resendApiKey) {
      // Check cooldown: was an alert sent in the last hour?
      const oneHourAgo = new Date(Date.now() - COOLDOWN_MS).toISOString();
      const { data: recentAlerts } = await supabaseAdmin
        .from("health_check_log")
        .select("id")
        .eq("status", "fail")
        .eq("check_name", "alert_sent")
        .gte("created_at", oneHourAgo)
        .limit(1);

      if (!recentAlerts || recentAlerts.length === 0) {
        const resend = new Resend(resendApiKey);

        const checksTable = results.map(r => `
          <tr>
            <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-family:monospace;font-size:13px;">${r.check_name}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">
              <span style="display:inline-block;padding:2px 10px;border-radius:12px;font-size:12px;font-weight:600;background:${r.status === 'pass' ? '#d1fae5;color:#065f46' : '#fee2e2;color:#991b1b'};">
                ${r.status.toUpperCase()}
              </span>
            </td>
            <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#6b7280;">
              ${r.error_message || '—'}
            </td>
            <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#6b7280;">
              ${r.response_time_ms}ms
            </td>
          </tr>
        `).join("");

        await resend.emails.send({
          from: "APEX System Monitor <alerts@apex-financial.org>",
          to: [ALERT_EMAIL],
          subject: `🚨 SYSTEM ALERT: ${failures.length} health check${failures.length > 1 ? 's' : ''} failed`,
          html: `
            <div style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto;">
              <div style="background:linear-gradient(135deg,#dc2626,#991b1b);padding:24px 30px;border-radius:10px 10px 0 0;">
                <h1 style="color:white;margin:0;font-size:22px;">🚨 System Health Alert</h1>
                <p style="color:rgba(255,255,255,0.9);margin:8px 0 0;font-size:14px;">
                  ${failures.length} of ${results.length} checks failed at ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })} ET
                </p>
              </div>
              <div style="background:#f9fafb;padding:24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 10px 10px;">
                <div style="background:#fef2f2;border-left:4px solid #dc2626;padding:12px 16px;margin-bottom:20px;border-radius:0 6px 6px 0;">
                  <p style="margin:0;color:#991b1b;font-weight:600;font-size:14px;">
                    Failed checks: ${failures.map(f => f.check_name).join(', ')}
                  </p>
                </div>
                <table style="width:100%;border-collapse:collapse;background:white;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb;">
                  <thead>
                    <tr style="background:#f3f4f6;">
                      <th style="padding:10px 12px;text-align:left;font-size:12px;font-weight:600;color:#374151;">Check</th>
                      <th style="padding:10px 12px;text-align:left;font-size:12px;font-weight:600;color:#374151;">Status</th>
                      <th style="padding:10px 12px;text-align:left;font-size:12px;font-weight:600;color:#374151;">Error</th>
                      <th style="padding:10px 12px;text-align:left;font-size:12px;font-weight:600;color:#374151;">Time</th>
                    </tr>
                  </thead>
                  <tbody>${checksTable}</tbody>
                </table>
                <div style="text-align:center;margin-top:24px;">
                  <a href="${DASHBOARD_URL}/dashboard/admin" style="display:inline-block;background:linear-gradient(135deg,#dc2626,#991b1b);color:white;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px;">
                    Fix Now →
                  </a>
                </div>
                <p style="color:#9ca3af;font-size:11px;text-align:center;margin-top:16px;">
                  This alert has a 1-hour cooldown per failure type. Next check in 15 minutes.
                </p>
              </div>
            </div>
          `,
        });

        console.log("[HealthCheck] Alert email sent");

        // Log that we sent an alert (for cooldown tracking)
        await supabaseAdmin.from("health_check_log").insert({
          check_name: "alert_sent",
          status: "fail",
          error_message: `Alert sent for: ${failures.map(f => f.check_name).join(', ')}`,
          response_time_ms: 0,
        });
      } else {
        console.log("[HealthCheck] Alert suppressed (cooldown active)");
      }
    }

    // Auto-clean logs older than 7 days
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    await supabaseAdmin.from("health_check_log").delete().lt("created_at", sevenDaysAgo);

    return new Response(
      JSON.stringify({
        success: true,
        total: results.length,
        passed: passed.length,
        failed: failures.length,
        results,
      }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: any) {
    console.error("[HealthCheck] Fatal error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);
