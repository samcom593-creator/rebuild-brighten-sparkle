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

const CALENDLY_LICENSED = "https://calendly.com/apexfinancialempire/1on1-call-clone";
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
  const first = app.first_name || "there";
  const body = app.license_status === "licensed"
    ? `${first} — Sam here. You're licensed, so you skip the course and go straight to contracting. Book 15 min: ${CALENDLY_LICENSED}`
    : `${first} — Sam at APEX. We pay for your licensing course and you're producing in ~2 weeks. Next step: ${GET_LICENSED_URL}`;
  const res = await supabase.functions.invoke("send-sms-auto-detect", {
    body: { phone: app.phone, message: body, applicationId: app.id },
  });
  if ((res as any).error) return { ok: false, error: String((res as any).error) };
  return { ok: true };
}

async function sendEmail(app: App): Promise<{ ok: boolean; error?: string }> {
  if (!app.email) return { ok: false, error: "no email" };
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) return { ok: false, error: "RESEND_API_KEY missing" };
  const resend = new Resend(resendKey);
  const first = app.first_name || "there";
  const age = ageDays(app.created_at);
  const licensed = app.license_status === "licensed";
  const cta = licensed
    ? `<a href="${CALENDLY_LICENSED}" style="display:inline-block;background:#0f172a;color:#fff;padding:12px 22px;border-radius:6px;text-decoration:none;font-weight:600">Book the 15-min call</a>`
    : `<a href="${GET_LICENSED_URL}" style="display:inline-block;background:#0f172a;color:#fff;padding:12px 22px;border-radius:6px;text-decoration:none;font-weight:600">Start the licensing path</a>`;
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,Segoe UI,Arial,sans-serif;color:#0f172a;line-height:1.5">
<div style="max-width:520px;margin:0 auto;padding:28px 22px">
<div style="font-weight:700;letter-spacing:0.5px;font-size:13px;margin-bottom:8px">APEX</div>
<p style="margin:0 0 14px">${first},</p>
<p style="margin:0 0 14px">You applied ${age} days ago and I haven't heard back. Two questions:</p>
<ol style="padding-left:18px;margin:0 0 18px"><li>Still want in?</li><li>If yes, hit the button. If no, reply STOP and I'll close your file.</li></ol>
<div style="margin:22px 0">${cta}</div>
<p style="color:#475569;font-size:13px;margin:24px 0 0">— Sam James · Managing Partner, APEX Financial</p>
</div></body></html>`;
  try {
    await resend.emails.send({
      from: "Sam James <sam@apex-financial.org>",
      to: app.email,
      subject: licensed ? `${first}, fast-track call?` : `${first}, still interested in getting licensed?`,
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

  // Dedupe by email (some applicants submitted 2-5 times). Keep the
  // newest row per email — that's the one most likely to still be active.
  // Refresh: commit ab299ce dedup logic
  const byEmail = new Map<string, App>();
  const orphans: App[] = [];
  for (const a of (apps ?? []) as App[]) {
    const key = (a.email ?? "").trim().toLowerCase();
    if (!key) { orphans.push(a); continue; }
    if (!byEmail.has(key)) byEmail.set(key, a);
  }
  const targets: App[] = [...byEmail.values(), ...orphans];

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
