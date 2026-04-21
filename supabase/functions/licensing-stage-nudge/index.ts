// Licensing stage-aware nudge sweep.
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
const CALENDLY_LICENSED = "https://calendly.com/sam-com593/1on1-call-clone";

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
    return { app, action: "sms", body: `Hey ${first}, Sam at APEX. Day 3 check-in — ready to pick your licensing course? We cover the cost. Start here: ${GET_LICENSED_URL}` };
  }
  if (p === "unlicensed" && applyAge === 10) {
    return { app, action: "sms", body: `${first}, still interested in getting licensed? We pay for the course, take ~2 weeks. Reply YES or visit ${GET_LICENSED_URL}` };
  }
  if (p === "course_purchased" && stageAge === 7) {
    return { app, action: "email", subject: "How's the course going?", html: `<p>Hey ${first},</p><p>You bought your course a week ago. How's it going? Most people finish in 2-3 weeks if they put in an hour a day.</p><p>If you're stuck on a section, reply and tell me which one.</p><p>Ready for the exam? <a href="${APPLY_URL}">Update your status</a>.</p><p>— Sam</p>` };
  }
  if (p === "course_purchased" && stageAge === 14) {
    return { app, action: "sms", body: `${first}, day 14 in the course — let's schedule your exam this week. Even if you're 80% ready, book the date and use it as a forcing function. Reply DATE.` };
  }
  if (p === "course_purchased" && stageAge === 30) {
    return { app, action: "manager_task", body: `${first} ${app.last_name} has been in course_purchased for 30 days. Call them — either finish the course or move them out of the pipeline.` };
  }
  if (p === "finished_course" && stageAge === 3) {
    return { app, action: "sms", body: `${first}, you finished the course. Book the exam now — dates fill fast. Reply and I'll help you schedule.` };
  }
  if (p === "test_scheduled" && stageAge === 1) {
    return { app, action: "sms", body: `${first}, how'd the exam go? Reply PASSED or FAILED and I'll send next steps.` };
  }
  if (p === "passed_test" && stageAge === 5 && !app.fingerprints_submitted_at) {
    return { app, action: "sms", body: `${first}, passed the exam — next: get fingerprints done. Most states do Fieldprint or IdentoGO. Takes 15 min. Need the link?` };
  }
  if (p === "waiting_on_license" && stageAge === 14) {
    return { app, action: "sms", body: `${first}, it's been 2 weeks waiting on the state license. They usually take 2-4 weeks — hang tight, I'll nudge the state if we hit 30.` };
  }
  return null;
}

async function sendSMS(app: App, body: string) {
  if (!app.phone) return { ok: false, error: "no phone" };
  await supabase.functions.invoke("send-sms-auto-detect", {
    body: { phone: app.phone, message: body, applicationId: app.id },
  });
  return { ok: true };
}

async function sendEmail(app: App, subject: string, html: string) {
  if (!app.email) return { ok: false, error: "no email" };
  try {
    await resend.emails.send({
      from: "Sam at APEX <sam@apex-financial.org>",
      to: app.email, subject, html,
    });
    return { ok: true };
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

  const { data: apps, error } = await supabase
    .from("applications")
    .select("id, first_name, last_name, email, phone, license_status, license_progress, created_at, course_purchased_at, exam_scheduled_at, exam_passed_at, fingerprints_submitted_at, last_contacted_at, hiring_manager_user_id, status")
    .neq("status", "rejected").neq("status", "terminated")
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
        results.push({ app_id: p.app.id, action: "sms", ok: r.ok, error: r.error });
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
