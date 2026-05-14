// seminar-reminder-tick — runs every 15 minutes (cron). For each upcoming
// seminar registration, sends a T-24h reminder and a T-1h reminder via the
// shared email helper. Idempotent through idempotency_keys.
//
// Required secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY.
// Schedule via pg_cron or external cron. config.toml: this runs on a schedule;
// verify_jwt is left default (authenticated invokes only).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { sendEmail } from "../_shared/email.ts";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const APP_URL = Deno.env.get("APP_BASE_URL") || "https://apex-financial.org";

function fmtSeminarTime(date: string): string {
  // seminar_date is a DATE column (Y-M-D). Sam runs Wed 7pm CT and Sat 10am CT.
  const d = new Date(`${date}T00:00:00-05:00`);
  const dow = d.getUTCDay(); // 0..6, treating Y-M-D as local CT date
  const hour = dow === 3 ? 19 : 10;
  const clock = dow === 3 ? "7:00 PM CT" : "10:00 AM CT";
  const ts = new Date(`${date}T${String(hour).padStart(2, "0")}:00:00-05:00`);
  return `${new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric" }).format(ts)} · ${clock}`;
}

function reminderHtml(name: string, when: string, hoursOut: 24 | 1): string {
  const headline = hoursOut === 24 ? "See you tomorrow" : "Starting in 1 hour";
  return `
    <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111">
      <h2 style="margin:0 0 16px 0">${headline}</h2>
      <p>Hey ${name},</p>
      <p>This is your reminder for the Apex Financial career seminar:</p>
      <p style="font-size:18px;font-weight:600">${when}</p>
      <p>Show up locked in. We move fast and we go deep.</p>
      <p><a href="${APP_URL}/seminar" style="display:inline-block;padding:12px 20px;background:#c8a445;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">Join the seminar</a></p>
      <p style="margin-top:24px;font-size:12px;color:#666">If you can't make it, reply STOP — we'll rebook you.</p>
    </div>`;
}

Deno.serve(async (_req) => {
  const now = new Date();
  const horizon = new Date(now.getTime() + 26 * 60 * 60 * 1000);

  // seminar_date is DATE — pull anything dated today or in the next ~26h.
  const todayIso = now.toISOString().slice(0, 10);
  const horizonIso = horizon.toISOString().slice(0, 10);

  const { data: regs, error } = await supabase
    .from("seminar_registrations")
    .select("id, first_name, email, seminar_date, attended")
    .gte("seminar_date", todayIso)
    .lte("seminar_date", horizonIso)
    .is("attended", null);

  if (error) {
    console.error("seminar-reminder-tick query error", error);
    return jsonResponse({ ok: false, error: error.message }, 500);
  }

  const out: any[] = [];
  for (const r of regs ?? []) {
    if (!r.email || !r.seminar_date) continue;
    const seminarTs = new Date(
      `${r.seminar_date}T${(() => {
        const dow = new Date(`${r.seminar_date}T00:00:00-05:00`).getUTCDay();
        return dow === 3 ? "19:00" : "10:00";
      })()}:00-05:00`,
    ).getTime();
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
        html: reminderHtml(r.first_name ?? "there", fmtSeminarTime(r.seminar_date), window),
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
