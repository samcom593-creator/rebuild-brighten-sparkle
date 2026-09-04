// Licensing stage-aware nudge sweep.
// Deploy: 401ea8e
//
// Runs daily. For each applicant in the licensing funnel, pick the right
// nudge based on (license_progress, time_in_stage). Idempotent via
// last_contacted_at stamping — no duplicate SMS in the same day.
//
// Cadence (days since stage-enter OR apply-date):
//   unlicensed  day 3   → SMS: "pick a course"
//   unlicensed  day 10  → SMS: "we'll cover it, here's the link"
//   course_purchased day 7  → email: "how's studying?"
//   course_purchased day 14 → SMS: "schedule your exam this week"
//   course_purchased day 30 → manager task: "call, they're stuck"
//   finished_course day 3   → SMS: "book your exam date"
//   test_scheduled   day 1 after exam_scheduled_at → SMS: "how'd it go?"
//   passed_test day 5 (no fingerprints yet) → SMS: "get fingerprints"
//   waiting_on_license day 14 → SMS: "state check-in"
//
// Modes:
//   { dry_run: true } → returns the plan, no sends
//   no body (cron)    → live

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const APPLY_URL = "https://apex-financial.org/apply";
const GET_LICENSED_URL = "https://apex-financial.org/get-licensed";
const CALENDLY_LICENSED = "https://calendly.com/apexfinancialempire/1on1-call-clone";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);
const resend = new Resend(Deno.env.get("RESEND_API_KEY") ?? "");

type App = {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  license_status: string | null;
  license_progress: string | null;
  created_at: string;
  course_purchased_at: string | null;
  exam_scheduled_at: string | null;
  exam_passed_at: string | null;
  fingerprints_submitted_at: string | null;
  last_contacted_at: string | null;
  hiring_manager_user_id: string | null;
  status: string;
};

function days(ts: string | null): number {
  if (!ts) return -1;
  const iso = ts.replace(/(\.\d{6})\d+/, "$1");
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

type Plan =
  | { app: App; action: "sms"; body: string }
  | { app: App; action: "email"; subject: string; html: string }
  | { app: App; action: "manager_task"; body: string };

function planFor(app: App): Plan | null {
  const first = app.first_name || "there";
  const applyAge = days(app.created_at);
  const stageAge = (
    app.license_progress === "course_purchased" ? days(app.course_purchased_at) :
    app.license_progress === "test_scheduled"   ? days(app.exam_scheduled_at) :
    app.license_progress === "passed_test"      ? days(app.exam_passed_at) :
    applyAge
  );

  // Gate: skip if contacted in last 72h (idempotency)
  if (app.last_contacted_at && days(app.last_contacted_at) < 3) return null;

  const p = app.license_progress ?? "unlicensed";

  if (p === "unlicensed" && applyAge === 3) {
    return { app, action: "sms", body: `${first} — Sam at APEX. You applied 3 days ago. Ready to start your licensing course? We cover the cost. Link: ${GET_LICENSED_URL}` };
  }
  if (p === "unlicensed" && applyAge === 10) {
    return { app, action: "sms", body: `${first} — still want in? We pay for your course and you're producing in ~2 weeks. Reply YES or tap ${GET_LICENSED_URL}` };
  }
  if (p === "course_purchased" && stageAge === 7) {
    return { app, action: "email", subject: `${first}, one-week check-in`, html: `<!doctype html><html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,Segoe UI,Arial,sans-serif;color:#0f172a;line-height:1.5"><div style="max-width:520px;margin:0 auto;padding:28px 22px"><div style="font-weight:700;letter-spacing:0.5px;font-size:13px;margin-bottom:8px">APEX</div><p style="margin:0 0 14px">${first},</p><p style="margin:0 0 14px">One week into the course. Most people finish in 2–3 weeks at an hour a day.</p><p style="margin:0 0 14px">Reply with one word so I know where you stand:</p><ul style="margin:0 0 14px;padding-left:18px;color:#334155"><li><strong>ON TRACK</strong> — you're cruising</li><li><strong>STUCK</strong> — one section is killing you</li><li><strong>PAUSE</strong> — life got in the way, need a plan</li></ul><p style="color:#475569;font-size:13px;margin:22px 0 0">— Sam James · Managing Partner, APEX Financial</p></div></body></html>` };
  }
  if (p === "course_purchased" && stageAge === 14) {
    return { app, action: "sms", body: `${first} — two weeks in. Book your exam date this week even if you're not 100% ready. The date is the forcing function. Reply with a target date.` };
  }
  if (p === "course_purchased" && stageAge === 30) {
    return { app, action: "manager_task", body: `${first} ${app.last_name} has been in course_purchased for 30 days. Call today — finish the course or move out of the pipeline.` };
  }
  if (p === "finished_course" && stageAge === 3) {
    return { app, action: "sms", body: `${first} — you finished the course. Book the exam now, dates fill up fast. Reply and I'll walk you through scheduling.` };
  }
  if (p === "test_scheduled" && stageAge === 1) {
    return { app, action: "sms", body: `${first} — how'd the exam go? Reply PASSED or FAILED and I'll send you the next step.` };
  }
  if (p === "passed_test" && stageAge === 5 && !app.fingerprints_submitted_at) {
    return { app, action: "sms", body: `${first} — you passed. Next: fingerprints (Fieldprint or IdentoGO, 15 min). Need the link for your state?` };
  }
  if (p === "waiting_on_license" && stageAge === 14) {
    return { app, action: "sms", body: `${first} — two weeks on the state license, normal is 2–4 weeks. If we hit 30, I'll escalate. Sit tight.` };
  }
  return null;
}

async function sendSMS(app: App, body: string) {
  if (!app.phone) return { ok: false, error: "no phone" };
  // MP-417: this used to `await` the invoke and return { ok: true }
  // unconditionally, so EVERY applicant with a phone was stamped
  // last_contacted_at by the caller below — including the ones whose SMS was
  // never sent. Two ways that lied:
  //   1. supabase.functions.invoke RESOLVES with { error } on a non-2xx
  //      instead of throwing, so "Phone is marked bad", "SMS consent is not
  //      recorded" and "Invalid phone number" all read as a send.
  //   2. send-sms-auto-detect answers HTTP 200 with outcome:"skipped" when no
  //      carrier is on file and it sent NOTHING (MP-270's contract, stated in
  //      that function's own comment: callers should branch on this rather
  //      than treating the person as contacted).
  // last_contacted_at is also this function's 72h idempotency gate, and the
  // nudge plans fire on exact stage-age equality (=== 1, 3, 5, 14), so a stamp
  // for a message that was never sent does not delay that rung — it deletes it.
  const { data, error } = await supabase.functions.invoke("send-sms-auto-detect", {
    body: { phone: app.phone, message: body, applicationId: app.id },
  });
  if (error) return { ok: false, error: error.message ?? String(error) };
  const outcome = (data as { outcome?: string } | null)?.outcome;
  if (outcome !== "sent") {
    return { ok: false, outcome: outcome ?? "unknown", error: `sms ${outcome ?? "unknown"} — nothing sent` };
  }
  return { ok: true, outcome };
}

async function sendEmail(app: App, subject: string, html: string) {
  if (!app.email) return { ok: false, error: "no email" };
  try {
    // MP-417: resend@2 RESOLVES with { error } on an API rejection instead of
    // throwing, so the catch below could never see one and every rejected
    // email returned ok:true and stamped last_contacted_at. The rest of this
    // repo already destructures { error } (notify-agent-live-field,
    // send-outreach-email, notify-module-progress); this one caller did not.
    // A receipt id is required, not merely the absence of a throw.
    const { data, error } = await resend.emails.send({
      from: "Sam at APEX <sam@apex-financial.org>",
      to: app.email, subject, html,
    });
    if (error) return { ok: false, error: (error as { message?: string }).message ?? String(error) };
    if (!data?.id) return { ok: false, error: "resend returned no message id" };
    return { ok: true, receipt: data.id };
  } catch (e: any) { return { ok: false, error: e?.message ?? String(e) }; }
}

async function createManagerTask(app: App, body: string) {
  if (!app.hiring_manager_user_id) return;
  await supabase.from("agent_tasks").insert({
    agent_id: null as any,
    assigned_by: app.hiring_manager_user_id,
    title: `Licensing stall: ${app.first_name} ${app.last_name}`,
    description: body,
    task_type: "licensing_followup",
    priority: "high",
    due_date: new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10),
  } as any);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  let body: { dry_run?: boolean; limit?: number } = {};
  try { body = await req.json(); } catch { /* empty */ }

  // application_status enum: new|reviewing|interview|contracting|approved|rejected|no_pickup
  const { data: apps, error } = await supabase
    .from("applications")
    .select("id, first_name, last_name, email, phone, license_status, license_progress, created_at, course_purchased_at, exam_scheduled_at, exam_passed_at, fingerprints_submitted_at, last_contacted_at, hiring_manager_user_id, status")
    .not("status", "in", "(rejected,approved)")
    .neq("license_progress", "licensed")
    .limit(body.limit ?? 500);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const plans: Plan[] = [];
  for (const a of (apps ?? []) as App[]) {
    const p = planFor(a);
    if (p) plans.push(p);
  }

  const summary: Record<string, number> = { sms: 0, email: 0, manager_task: 0 };
  const results: any[] = [];
  for (const p of plans) {
    summary[p.action]++;
    if (body.dry_run) { results.push({ app_id: p.app.id, action: p.action }); continue; }
    try {
      if (p.action === "sms") {
        const r = await sendSMS(p.app, p.body);
        if (r.ok) await supabase.from("applications").update({ last_contacted_at: new Date().toISOString() }).eq("id", p.app.id);
        results.push({ app_id: p.app.id, action: "sms", ok: r.ok, outcome: (r as { outcome?: string }).outcome, error: r.error });
      } else if (p.action === "email") {
        const r = await sendEmail(p.app, p.subject, p.html);
        if (r.ok) await supabase.from("applications").update({ last_contacted_at: new Date().toISOString() }).eq("id", p.app.id);
        results.push({ app_id: p.app.id, action: "email", ok: r.ok, error: r.error });
      } else if (p.action === "manager_task") {
        await createManagerTask(p.app, p.body);
        results.push({ app_id: p.app.id, action: "manager_task", ok: true });
      }
    } catch (e: any) {
      results.push({ app_id: p.app.id, action: p.action, ok: false, error: e?.message ?? String(e) });
    }
  }

  return new Response(JSON.stringify({
    ok: true,
    mode: body.dry_run ? "dry_run" : "live",
    processed: plans.length,
    summary,
    results: body.dry_run ? results : undefined,
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
// deploy trigger: 4538a9b
