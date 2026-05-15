// seminar-reminder-tick — runs every 15 minutes (cron). For each upcoming
// seminar registration, sends a T-24h reminder and a T-1h reminder via the
// shared email helper. Idempotent through idempotency_keys.
//
// Required secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY.
// Schedule via pg_cron or external cron. config.toml: this runs on a schedule;
// verify_jwt is left default (authenticated invokes only).
//
// TODO (SMS reminders): we deliberately do NOT send SMS here yet. APEX has
// no SMS provider wired (Twilio creds aren't set). Adding a fake SMS path
// would silently fail. When Sam picks a provider, plumb it in here behind
// `Deno.env.get("TWILIO_ACCOUNT_SID")` or equivalent, using the same
// idempotency key namespace ("seminar_reminder:<id>:24h_sms") to avoid
// double-sends.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { sendEmail } from "../_shared/email.ts";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const APP_URL = Deno.env.get("APP_BASE_URL") || "https://apex-financial.org";
const SEMINAR_TZ = "America/Chicago";

// Returns the CT UTC offset (in minutes) for a given UTC instant. Handles
// DST transitions automatically — never hardcode -05:00 or -06:00.
function ctOffsetMinutes(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: SEMINAR_TZ,
    timeZoneName: "shortOffset",
  }).formatToParts(at);
  const tz = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT-6";
  // e.g. "GMT-5" → -300, "GMT-6" → -360
  const match = /GMT([+-]?\d+)(?::(\d+))?/.exec(tz);
  if (!match) return -360;
  const hours = Number(match[1]);
  const mins = Number(match[2] ?? 0);
  const sign = hours < 0 ? -1 : 1;
  return sign * (Math.abs(hours) * 60 + mins);
}

// Compute the UTC timestamp for a given CT date (YYYY-MM-DD) at the given
// CT hour-of-day. DST-safe.
function ctDateAtHour(dateStr: string, hourCT: number): Date {
  // Probe with an arbitrary UTC instant near that date to figure out the
  // current CT offset, then construct the UTC timestamp accordingly.
  const probe = new Date(`${dateStr}T${String(hourCT).padStart(2, "0")}:00:00Z`);
  const offMin = ctOffsetMinutes(probe);
  // CT clock time - offset = UTC. offset for CT is negative (e.g. -300).
  return new Date(probe.getTime() - offMin * 60 * 1000);
}

function fmtSeminarTime(date: string): string {
  // seminar_date is a DATE column (YYYY-MM-DD). Sam runs Wed 7pm CT and
  // Sat 10am CT. Compute the day-of-week by parsing the date as midnight UTC.
  const probe = new Date(`${date}T12:00:00Z`);
  const ctDow = parseInt(
    new Intl.DateTimeFormat("en-US", { timeZone: SEMINAR_TZ, weekday: "narrow" })
      .formatToParts(probe)
      .find((p) => p.type === "weekday")?.value ?? "0",
    10,
  );
  // Intl narrow weekday is a letter not a number; better to compute via Date methods on a CT-zoned timestamp.
  const noonCT = ctDateAtHour(date, 12);
  const dow = new Intl.DateTimeFormat("en-US", { timeZone: SEMINAR_TZ, weekday: "long" }).format(noonCT);
  const hour = dow === "Wednesday" ? 19 : 10;
  const clock = dow === "Wednesday" ? "7:00 PM CT" : "10:00 AM CT";
  const ts = ctDateAtHour(date, hour);
  void ctDow; // narrow-letter path retained above for completeness
  return `${new Intl.DateTimeFormat("en-US", {
    timeZone: SEMINAR_TZ, weekday: "long", month: "short", day: "numeric",
  }).format(ts)} · ${clock}`;
}

function reminderHtml(name: string, when: string, hoursOut: 24 | 1, meetingUrl: string, meetingLabel: string): string {
  const headline = hoursOut === 24 ? "See you tomorrow" : "Starting in 1 hour";
  return `
    <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111">
      <h2 style="margin:0 0 16px 0">${headline}</h2>
      <p>Hey ${name},</p>
      <p>This is your reminder for the Apex Financial career seminar:</p>
      <p style="font-size:18px;font-weight:600">${when}</p>
      <p>Show up locked in. We move fast and we go deep.</p>
      <p><a href="${meetingUrl}" style="display:inline-block;padding:12px 20px;background:#c8a445;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">${meetingLabel}</a></p>
      <p style="margin-top:24px;font-size:12px;color:#666">If you can't make it, reply STOP — we'll rebook you.</p>
    </div>`;
}

async function loadMeetingConfig(): Promise<{ url: string; label: string }> {
  const { data } = await supabase
    .from("system_settings")
    .select("key, value")
    .in("key", ["seminar_meeting_url", "seminar_meeting_url_label"]);
  const map = new Map((data ?? []).map((r: any) => [r.key, r.value as string]));
  return {
    url: map.get("seminar_meeting_url") || `${APP_URL}/seminar/join`,
    label: map.get("seminar_meeting_url_label") || "Join the seminar",
  };
}

Deno.serve(async (_req) => {
  const now = new Date();
  const horizon = new Date(now.getTime() + 26 * 60 * 60 * 1000);
  const meetingCfg = await loadMeetingConfig();

  // seminar_date is DATE — pull anything dated today or in the next ~26h.
  const todayIso = now.toISOString().slice(0, 10);
  const horizonIso = horizon.toISOString().slice(0, 10);

  const { data: regs, error } = await supabase
    .from("seminar_registrations")
    .select("id, first_name, email, seminar_date, attended, reminder_opt_in")
    .gte("seminar_date", todayIso)
    .lte("seminar_date", horizonIso)
    .eq("reminder_opt_in", true)
    .or("attended.is.null,attended.eq.false");

  if (error) {
    console.error("seminar-reminder-tick query error", error);
    return jsonResponse({ ok: false, error: error.message }, 500);
  }

  const out: any[] = [];
  for (const r of regs ?? []) {
    if (!r.email || !r.seminar_date) continue;
    // Use the DST-safe CT helper instead of a hardcoded -05:00 offset.
    const noonCT = ctDateAtHour(r.seminar_date, 12);
    const dow = new Intl.DateTimeFormat("en-US", { timeZone: SEMINAR_TZ, weekday: "long" }).format(noonCT);
    const startHour = dow === "Wednesday" ? 19 : 10;
    const seminarTs = ctDateAtHour(r.seminar_date, startHour).getTime();
    const hoursOut = (seminarTs - now.getTime()) / 36e5;
    const window = hoursOut >= 23.5 && hoursOut <= 24.5
      ? 24
      : hoursOut >= 0.5 && hoursOut <= 1.5
        ? 1
        : null;
    if (!window) continue;

    const key = `seminar_reminder:${r.id}:${window}h`;
    const { error: idemErr } = await supabase.from("idempotency_keys").insert({ key });
    if (idemErr?.message?.includes("duplicate")) { out.push({ id: r.id, skipped: "dup" }); continue; }
    if (idemErr) { out.push({ id: r.id, idemErr: idemErr.message }); continue; }

    try {
      await sendEmail({
        to: r.email,
        subject: window === 24 ? "Reminder: Apex seminar tomorrow" : "Starting in 1 hour — Apex seminar",
        html: reminderHtml(r.first_name ?? "there", fmtSeminarTime(r.seminar_date), window, meetingCfg.url, meetingCfg.label),
        tagName: "seminar_reminder",
      });
      out.push({ id: r.id, window });
    } catch (e: any) {
      console.error("seminar reminder send failed", e);
      out.push({ id: r.id, error: e?.message });
    }
  }

  return jsonResponse({ ok: true, checked: regs?.length ?? 0, sent: out });
});
