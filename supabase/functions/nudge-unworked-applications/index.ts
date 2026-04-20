// Nudge unworked applications.
//
// Scans applications.status='new' with no recorded contact and runs an
// age-bucketed outreach cadence, then stamps last_contacted_at so the
// same applicant isn't pinged twice a day.
//
// Modes:
//   { dry_run: true }                     → returns the target buckets, sends nothing
//   { dry_run: false, limit: N }          → processes up to N applications
//   no body                               → live, full sweep (called from cron)
//
// Buckets (age = now - created_at):
//   0-3  days: applicant SMS (Calendly for licensed, /get-licensed for unlicensed)
//   4-14 days: applicant email follow-up
//   15-30 days: flip status='no_pickup' (automation-assigned, manual reviewable)
//   31+  days: flip status='rejected' with notes='auto-timed-out'
// Deploy trigger: commit 00d3138

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id, idempotency-key",
};

const CALENDLY_LICENSED = "https://calendly.com/sam-com593/1on1-call-clone";
const GET_LICENSED_URL = "https://apex-financial.org/get-licensed";
const APPLY_URL = "https://apex-financial.org/apply";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

type App = {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  license_status: "licensed" | "unlicensed" | "pending" | null;
  status: string;
  created_at: string;
  contacted_at: string | null;
  last_contacted_at: string | null;
  hiring_manager_user_id: string | null;
};

function ageDays(created_at: string): number {
  // Postgres fractional seconds can be up to 7 digits; trim to 6 for Date.
  const iso = created_at.replace(/(\.\d{6})\d+/, "$1");
  const ms = Date.now() - new Date(iso).getTime();
  return Math.floor(ms / 86_400_000);
}

function bucket(app: App): "sms" | "email" | "no_pickup" | "reject" {
  const age = ageDays(app.created_at);
  if (age <= 3) return "sms";
  if (age <= 14) return "email";
  if (age <= 30) return "no_pickup";
  return "reject";
}

async function sendSMS(app: App): Promise<{ ok: boolean; error?: string }> {
  if (!app.phone) return { ok: false, error: "no phone" };
  const firstPath = (app.license_status === "licensed" ? CALENDLY_LICENSED : GET_LICENSED_URL);
  const body = app.license_status === "licensed"
    ? `Hey ${app.first_name}, Sam at APEX. Saw your app — you're licensed, let's fast-track you. Book a 15-min call: ${firstPath}`
    : `Hey ${app.first_name}, Sam at APEX. We saw your app. We cover licensing costs and get you producing in ~2 weeks. Next step: ${firstPath}`;
  const res = await supabase.functions.invoke("send-sms-auto-detect", {
    body: { phone: app.phone, message: body, application_id: app.id },
  });
  if ((res as any).error) return { ok: false, error: String((res as any).error) };
  return { ok: true };
}

async function sendEmail(app: App): Promise<{ ok: boolean; error?: string }> {
  if (!app.email) return { ok: false, error: "no email" };
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) return { ok: false, error: "RESEND_API_KEY missing" };
  const resend = new Resend(resendKey);
  const cta = app.license_status === "licensed"
    ? `<a href="${CALENDLY_LICENSED}" style="display:inline-block;background:#10b981;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:bold">Book my 15-min fast-track call</a>`
    : `<a href="${GET_LICENSED_URL}" style="display:inline-block;background:#10b981;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:bold">Start the licensing path</a>`;
  const age = ageDays(app.created_at);
  const html = `
    <div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;color:#0f172a;">
      <h2 style="margin:0 0 12px">Still interested in APEX, ${app.first_name}?</h2>
      <p>Your application is ${age} days old and I haven't heard back. Two questions:</p>
      <ol>
        <li>Still want in?</li>
        <li>If yes, pick up the next step below. If no, reply STOP and I'll close the file.</li>
      </ol>
      <p style="text-align:center;margin:32px 0">${cta}</p>
      <p style="color:#64748b;font-size:14px">— Sam James, Managing Partner, APEX Financial</p>
    </div>`;
  try {
    await resend.emails.send({
      from: "Sam at APEX <sam@apex-financial.org>",
      to: app.email,
      subject: app.license_status === "licensed" ? "Fast-track call — still interested?" : "Still want to get licensed with APEX?",
      html,
    });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}

async function markContacted(appId: string) {
  await supabase.from("applications").update({ last_contacted_at: new Date().toISOString() }).eq("id", appId);
}

async function flipStatus(appId: string, status: "no_pickup" | "rejected", note: string) {
  await supabase.from("applications").update({
    status,
    notes: note,
    last_contacted_at: new Date().toISOString(),
  }).eq("id", appId);
}

type Result = { app_id: string; bucket: string; ok: boolean; error?: string };

async function sweep(dryRun: boolean, limit: number): Promise<{ processed: number; buckets: Record<string, number>; results: Result[] }> {
  const { data: apps, error } = await supabase
    .from("applications")
    .select("id, first_name, last_name, email, phone, license_status, status, created_at, contacted_at, last_contacted_at, hiring_manager_user_id")
    .eq("status", "new")
    .is("contacted_at", null)
    .is("last_contacted_at", null)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  const targets = (apps ?? []) as App[];

  const buckets: Record<string, number> = { sms: 0, email: 0, no_pickup: 0, reject: 0 };
  const results: Result[] = [];

  for (const app of targets) {
    const b = bucket(app);
    buckets[b]++;
    if (dryRun) {
      results.push({ app_id: app.id, bucket: b, ok: true });
      continue;
    }
    let r: { ok: boolean; error?: string };
    switch (b) {
      case "sms":
        r = await sendSMS(app);
        if (r.ok) await markContacted(app.id);
        break;
      case "email":
        r = await sendEmail(app);
        if (r.ok) await markContacted(app.id);
        break;
      case "no_pickup":
        await flipStatus(app.id, "no_pickup", "auto-flipped: 15-30d no contact");
        r = { ok: true };
        break;
      case "reject":
        await flipStatus(app.id, "rejected", "auto-timed-out: 30d+ no contact");
        r = { ok: true };
        break;
    }
    results.push({ app_id: app.id, bucket: b, ok: r!.ok, error: r!.error });
  }

  return { processed: targets.length, buckets, results };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  let body: { dry_run?: boolean; limit?: number } = {};
  try { body = await req.json(); } catch { /* allow empty */ }

  try {
    const result = await sweep(body.dry_run ?? false, body.limit ?? 500);
    return new Response(JSON.stringify({ mode: body.dry_run ? "dry_run" : "live", ...result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("[nudge-unworked-applications] fatal", e);
    return new Response(JSON.stringify({ error: e?.message ?? "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
