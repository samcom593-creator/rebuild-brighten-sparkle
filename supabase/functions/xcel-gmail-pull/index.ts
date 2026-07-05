// xcel-gmail-pull — daily Gmail puller for Xcel Solutions exports.
//
// Workflow:
//   1. Search Gmail for messages labeled "Apex/XCEL" newer than 36h
//      (overlap = idempotent — xcel-import dedupes by email + stage).
//   2. For each message with a .csv attachment, fetch the bytes,
//      decode base64url to UTF-8, then POST to /xcel-import.
//   3. Apply the "Apex/XCEL-Processed" label so the same CSV doesn't
//      get pulled twice; mark unread → read.
//
// Why: Sam was manually exporting + posting Xcel CSV. 39 applicants
// were frozen at "course_purchased" because the manual step lagged.
// This fn drains the lag down to 5 min by running on cron.
//
// Auth: GOOGLE_REFRESH_TOKEN from system_settings.gmail_xcel_oauth
//       (refresh_token, client_id, client_secret). Returns 503 if
//       creds missing so cron can back off cleanly.
//
// Silent-success guard (MP-238):
//   Every run is logged to automation_runs. Before returning we check
//   the last 7 days of runs — if EVERY run in that window returned 0
//   found messages, we log an error and insert a critical row into
//   system_health_logs so it surfaces on /admin/system-health. That
//   catches the failure mode where auth silently drifted (returns 200,
//   0 messages) but the pipeline is actually dead — same disease as
//   the InsuraCloud 465 fake-success rows and the AgentLink cookie
//   rot. Never let a green light lie again.
//
// PL-091 · 2026-05-29
// MP-238 · 2026-07-05 — silent-success guard

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const XCEL_LABEL_NAME = "Apex/XCEL";
const XCEL_DONE_LABEL = "Apex/XCEL-Processed";
const AUTOMATION_NAME = "xcel-gmail-pull";
const SILENT_SUCCESS_WINDOW_DAYS = 7;
// Require at least this many logged runs in the window before we cry
// wolf — otherwise a fresh cron slot with 2 runs and 0 emails looks
// identical to a 7-day auth failure.
const SILENT_SUCCESS_MIN_RUNS = 5;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

type OauthCreds = {
  client_id: string;
  client_secret: string;
  refresh_token: string;
};

async function loadCreds(): Promise<OauthCreds | null> {
  const { data } = await supabase
    .from("system_settings")
    .select("value")
    .eq("key", "gmail_xcel_oauth")
    .maybeSingle();
  const value = (data?.value ?? null) as OauthCreds | null;
  if (!value?.client_id || !value?.client_secret || !value?.refresh_token) return null;
  return value;
}

async function exchangeForAccessToken(c: OauthCreds): Promise<string> {
  const body = new URLSearchParams({
    client_id: c.client_id,
    client_secret: c.client_secret,
    refresh_token: c.refresh_token,
    grant_type: "refresh_token",
  });
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!r.ok) throw new Error(`oauth_${r.status}: ${await r.text()}`);
  const j = await r.json() as { access_token: string };
  return j.access_token;
}

async function gmail<T = any>(path: string, token: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  if (!r.ok) throw new Error(`gmail_${r.status}: ${await r.text()}`);
  return r.json() as Promise<T>;
}

// Log every run into automation_runs so the 7-day silent-success
// guard has a persistent history to inspect. Best-effort: a logging
// failure never blocks the actual pull.
async function logAutomationRun(payload: {
  status: "success" | "error" | "skipped";
  found: number;
  processed: number;
  imported_rows_total: number;
  errors: string[];
  duration_ms: number;
  error_message?: string;
}) {
  try {
    await supabase.from("automation_runs").insert({
      automation_name: AUTOMATION_NAME,
      status: payload.status,
      agents_affected: payload.imported_rows_total,
      duration_ms: payload.duration_ms,
      error_message: payload.error_message ?? null,
      metadata: {
        found: payload.found,
        processed: payload.processed,
        imported_rows_total: payload.imported_rows_total,
        error_sample: payload.errors.slice(0, 5),
      },
    });
  } catch (err) {
    console.error(`[xcel-gmail-pull] automation_runs insert failed:`, err);
  }
}

// Hard assertion: if EVERY successful run in the last 7 days returned
// 0 found messages (and we've logged at least SILENT_SUCCESS_MIN_RUNS
// of them), the puller is silently succeeding — most likely gmail_xcel_oauth
// rotated, the label got renamed, or the search query drifted. We log a
// hard error AND drop a critical row into system_health_logs so the
// /admin/system-health dashboard shows it in red on the next refresh.
async function checkSilentSuccessStreak(): Promise<{
  triggered: boolean;
  run_count: number;
  days_since_last_hit: number | null;
}> {
  const since = new Date(Date.now() - SILENT_SUCCESS_WINDOW_DAYS * 86400_000).toISOString();

  const { data: runs, error } = await supabase
    .from("automation_runs")
    .select("ran_at, status, metadata")
    .eq("automation_name", AUTOMATION_NAME)
    .gte("ran_at", since)
    .order("ran_at", { ascending: false })
    .limit(500);

  if (error || !runs) {
    console.error(`[xcel-gmail-pull] silent-success check read failed:`, error);
    return { triggered: false, run_count: 0, days_since_last_hit: null };
  }

  const successRuns = runs.filter((r) => r.status === "success");
  if (successRuns.length < SILENT_SUCCESS_MIN_RUNS) {
    return { triggered: false, run_count: successRuns.length, days_since_last_hit: null };
  }

  const anyFound = successRuns.some(
    (r) => Number((r.metadata as any)?.found ?? 0) > 0,
  );
  if (anyFound) {
    return { triggered: false, run_count: successRuns.length, days_since_last_hit: 0 };
  }

  // Find last time we actually pulled anything (outside window is fine).
  const { data: lastHit } = await supabase
    .from("automation_runs")
    .select("ran_at, metadata")
    .eq("automation_name", AUTOMATION_NAME)
    .eq("status", "success")
    .order("ran_at", { ascending: false })
    .limit(50);
  const lastHitRow = (lastHit ?? []).find(
    (r) => Number((r.metadata as any)?.found ?? 0) > 0,
  );
  const daysSince = lastHitRow
    ? Math.floor(
        (Date.now() - new Date(lastHitRow.ran_at as string).getTime()) / 86400_000,
      )
    : SILENT_SUCCESS_WINDOW_DAYS;

  const msg =
    `xcel-gmail-pull returned 0 found messages for ${successRuns.length} consecutive ` +
    `successful runs over the last ${SILENT_SUCCESS_WINDOW_DAYS}d ` +
    `(last actual hit: ${daysSince}d ago). Check system_settings.gmail_xcel_oauth ` +
    `refresh_token, the "Apex/XCEL" label, and the Gmail search query.`;

  console.error(`[xcel-gmail-pull] SILENT-SUCCESS GUARD TRIPPED — ${msg}`);

  const healthResult = {
    service: "Gmail Puller (Xcel)",
    status: "down" as const,
    responseTime: 0,
    message: msg,
    requiresAction: true,
    actionRequired:
      "Re-auth gmail_xcel_oauth (mint fresh refresh_token) or verify the Apex/XCEL Gmail label + filter still routes new Xcel exports.",
  };

  try {
    await supabase.from("system_health_logs").insert({
      overall_status: "critical",
      critical_count: 1,
      warning_count: 0,
      auto_fixed: [],
      results: [healthResult],
    });
  } catch (err) {
    console.error(`[xcel-gmail-pull] system_health_logs insert failed:`, err);
  }

  return {
    triggered: true,
    run_count: successRuns.length,
    days_since_last_hit: daysSince,
  };
}

function b64UrlDecode(s: string): Uint8Array {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const normalized = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(normalized);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const startedAt = Date.now();

  const creds = await loadCreds();
  if (!creds) {
    await logAutomationRun({
      status: "skipped",
      found: 0,
      processed: 0,
      imported_rows_total: 0,
      errors: ["gmail_oauth_missing"],
      duration_ms: Date.now() - startedAt,
      error_message: "gmail_oauth_missing",
    });
    return new Response(
      JSON.stringify({ error: "gmail_oauth_missing", hint: "set system_settings.gmail_xcel_oauth = {client_id, client_secret, refresh_token}" }),
      { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    const token = await exchangeForAccessToken(creds);

    // Resolve label IDs.
    const labelsResp = await gmail<{ labels: Array<{ id: string; name: string }> }>("/labels", token);
    const inLabel = labelsResp.labels.find((l) => l.name === XCEL_LABEL_NAME);
    if (!inLabel) {
      return new Response(JSON.stringify({ error: `label_not_found:${XCEL_LABEL_NAME}` }), {
        status: 412, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    let doneLabel = labelsResp.labels.find((l) => l.name === XCEL_DONE_LABEL);
    if (!doneLabel) {
      doneLabel = await gmail<{ id: string; name: string }>("/labels", token, {
        method: "POST",
        body: JSON.stringify({ name: XCEL_DONE_LABEL, labelListVisibility: "labelShow", messageListVisibility: "show" }),
      });
    }

    // Pull last 36h of unprocessed messages.
    const query = `label:${XCEL_LABEL_NAME} -label:${XCEL_DONE_LABEL} newer_than:2d has:attachment filename:csv`;
    const list = await gmail<{ messages?: Array<{ id: string }> }>(`/messages?q=${encodeURIComponent(query)}`, token);
    const ids = (list.messages ?? []).map((m) => m.id);
    const summary = { found: ids.length, processed: 0, imported_rows_total: 0, errors: [] as string[] };

    for (const id of ids) {
      try {
        const msg = await gmail<any>(`/messages/${id}`, token);
        const parts: any[] = [];
        const walk = (p: any) => {
          if (!p) return;
          if (Array.isArray(p.parts)) p.parts.forEach(walk);
          parts.push(p);
        };
        walk(msg.payload);

        const csvPart = parts.find((p) =>
          (p.filename ?? "").toLowerCase().endsWith(".csv") &&
          p.body?.attachmentId
        );
        if (!csvPart) {
          summary.errors.push(`msg ${id}: no csv attachment`);
          continue;
        }

        const att = await gmail<{ data: string }>(`/messages/${id}/attachments/${csvPart.body.attachmentId}`, token);
        const bytes = b64UrlDecode(att.data);
        const text = new TextDecoder("utf-8").decode(bytes);

        const importResp = await fetch(`${SUPABASE_URL}/functions/v1/xcel-import`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${SERVICE_KEY}`,
            "Content-Type": "text/csv",
          },
          body: text,
        });
        if (!importResp.ok) {
          summary.errors.push(`msg ${id}: xcel-import ${importResp.status}: ${(await importResp.text()).slice(0, 240)}`);
          continue;
        }
        const importJson = await importResp.json().catch(() => ({} as any));
        summary.imported_rows_total += Number(importJson?.updated ?? importJson?.matched ?? 0);

        // Tag processed so we don't double-pull.
        await gmail(`/messages/${id}/modify`, token, {
          method: "POST",
          body: JSON.stringify({ addLabelIds: [doneLabel!.id], removeLabelIds: ["UNREAD"] }),
        });
        summary.processed += 1;
      } catch (err: any) {
        summary.errors.push(`msg ${id}: ${err?.message ?? "unknown"}`);
      }
    }

    await logAutomationRun({
      status: "success",
      found: summary.found,
      processed: summary.processed,
      imported_rows_total: summary.imported_rows_total,
      errors: summary.errors,
      duration_ms: Date.now() - startedAt,
    });

    const guard = await checkSilentSuccessStreak();

    return new Response(JSON.stringify({ ...summary, silent_success_guard: guard }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    await logAutomationRun({
      status: "error",
      found: 0,
      processed: 0,
      imported_rows_total: 0,
      errors: [String(e?.message ?? "unknown")],
      duration_ms: Date.now() - startedAt,
      error_message: String(e?.message ?? "unknown"),
    });
    return new Response(JSON.stringify({ error: e?.message ?? "unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
