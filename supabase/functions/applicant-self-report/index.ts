/**
 * applicant-self-report
 *
 * Public, no-auth fallback for /status/:id self-progress reporting.
 * Sam-feedback 2026-06-03: XCEL Gmail pull is unreliable; applicants need a
 * way to stamp their own progress so they don't disappear from the funnel.
 *
 * Validates input by application_id only (the UUID is the secret), maps the
 * milestone to a column update, broadcasts to the pipeline group when a
 * managerial-action milestone fires.
 */
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TG_TOKEN = Deno.env.get("APEX_TELEGRAM_BOT_TOKEN") ?? "";

const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

type Milestone =
  | "started_course"
  | "finished_course"
  | "scheduled_exam"
  | "passed_exam"
  | "licensed"
  | "stuck";

interface Body {
  application_id?: string;
  milestone?: Milestone;
}

function stampForMilestone(m: Milestone): Record<string, string | null> {
  const now = new Date().toISOString();
  switch (m) {
    case "started_course":
      return { course_started_at: now, next_step_stage_key: "started_prelicense", course_purchased_at: now };
    case "finished_course":
      return { course_started_at: now, next_step_stage_key: "finished_prelicense", course_purchased_at: now };
    case "scheduled_exam":
      return { exam_scheduled_at: now, next_step_stage_key: "finished_prelicense" };
    case "passed_exam":
      return { exam_passed_at: now, next_step_stage_key: "passed_exam" };
    case "licensed":
      return { license_approved_at: now, next_step_stage_key: "passed_exam", license_status: "licensed" };
    case "stuck":
      return { next_action: "STUCK_MANAGER_INTERVENTION", next_action_at: now, next_action_due_at: now };
  }
}

async function pipelinePing(text: string) {
  if (!TG_TOKEN) return;
  const { data: g } = await sb
    .from("telegram_groups")
    .select("chat_id")
    .in("type", ["pipeline", "onboarding"])
    .eq("is_active", true)
    .gt("chat_id", 0)
    .limit(1)
    .maybeSingle();
  const chat_id = g?.chat_id;
  if (!chat_id) return;
  await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id, text, parse_mode: "HTML" }),
  }).catch(() => {});
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body: Body = await req.json();
    if (!body.application_id || !body.milestone) {
      return new Response(JSON.stringify({ error: "Missing application_id or milestone" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const { data: app, error: appErr } = await sb
      .from("applications")
      .select("id, first_name, last_name, phone, email, referral_manager_id, assigned_agent_id")
      .eq("id", body.application_id)
      .maybeSingle();
    if (appErr || !app) {
      return new Response(JSON.stringify({ error: "Application not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const stamp = stampForMilestone(body.milestone);
    stamp.updated_at = new Date().toISOString();

    const { error: updErr } = await sb
      .from("applications")
      .update(stamp)
      .eq("id", body.application_id);
    if (updErr) {
      return new Response(JSON.stringify({ error: updErr.message }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // Pipeline broadcast on the major ones
    const name = `${app.first_name ?? ""} ${app.last_name ?? ""}`.trim() || "An applicant";
    if (body.milestone === "stuck") {
      await pipelinePing(
        `🆘 <b>STUCK</b> — <b>${name}</b> tagged themselves as stuck.\n` +
          `📱 ${app.phone ?? "(no phone)"}\n` +
          `📧 ${app.email ?? "(no email)"}\n\n` +
          `<b>Call within 1 hour.</b>`,
      );
    } else if (body.milestone === "licensed") {
      await pipelinePing(`🏆 <b>${name}</b> self-reported LICENSED. Verify + activate.`);
    } else if (body.milestone === "passed_exam") {
      await pipelinePing(`✅ <b>${name}</b> self-reported PASSED EXAM. License approval next.`);
    } else if (body.milestone === "finished_course") {
      await pipelinePing(`📘 <b>${name}</b> finished the prelicensing course.`);
    } else if (body.milestone === "started_course") {
      await pipelinePing(`📖 <b>${name}</b> started the prelicensing course.`);
    }

    return new Response(JSON.stringify({ ok: true, milestone: body.milestone }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (e: any) {
    console.error("self-report error:", e);
    return new Response(JSON.stringify({ error: e?.message ?? "Unknown error" }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
};

serve(handler);
