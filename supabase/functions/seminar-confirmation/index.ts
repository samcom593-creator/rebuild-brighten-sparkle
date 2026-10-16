// PL-SEMINAR-OFF → interview invite (2026-10-15, per Sam).
//
// The seminar funnel is retired: it emailed every applicant a "Seminar Zoom is
// locked" Friday-call email that pointed at a dead Calendly link, and recruits
// were confused. This function (the fire-and-forget applicant email that
// submit-application dispatches on every submission) now does ONE thing:
//
//   - LICENSED applicant  -> email the interview booking link (the live
//                            "Licensed Call" event: book your interview).
//   - everyone else       -> no-op (no seminar, nothing sent).
//
// APEX voice: direct, no em-dashes, no AI-tells.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json", ...corsHeaders } });

const INTERVIEW_URL = "https://calendly.com/apexfinancialempire/1on1-call-clone"; // live "Licensed Call" event
const IG = "@sell4daddy";
const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const resendKey = Deno.env.get("RESEND_API_KEY");
const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
const resend = resendKey ? new Resend(resendKey) : null;

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let body: { application_id?: string };
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
  const id = (body.application_id || "").trim();
  if (!uuidRe.test(id)) return json({ ok: true, skipped: "no valid application_id" });

  const { data: app, error } = await supabase
    .from("applications")
    .select("first_name, email, license_status")
    .eq("id", id)
    .maybeSingle();
  if (error || !app) return json({ ok: true, skipped: "application not found" });

  // Only licensed applicants get the interview link. No seminar for anyone.
  if (String(app.license_status || "").toLowerCase() !== "licensed") {
    return json({ ok: true, skipped: "not licensed - no email sent" });
  }
  if (!app.email) return json({ ok: true, skipped: "no email on file" });

  const first = esc(String(app.first_name || "there").trim() || "there");
  const subject = "You're licensed. Book your Apex interview.";
  const html = `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;">
    <div style="background:#047857;padding:22px 20px;text-align:center;border-radius:12px 12px 0 0;">
      <h1 style="color:#fff;margin:0;font-size:24px;">You're licensed. Let's talk.</h1>
    </div>
    <div style="padding:26px 22px;background:#ffffff;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;">
      <p style="color:#111827;font-size:16px;margin:0 0 14px;">${first}, you're licensed, so the next step is a quick 10 to 15 minute interview call.</p>
      <p style="color:#374151;font-size:15px;line-height:1.55;margin:0 0 22px;">Pick a time that works for you. We'll walk your plan and get you moving.</p>
      <p style="text-align:center;margin:0 0 22px;">
        <a href="${INTERVIEW_URL}" style="display:inline-block;background:#047857;color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:700;font-size:16px;">Book your interview</a>
      </p>
      <p style="color:#6b7280;font-size:13px;margin:0;">Or paste this link: <a href="${INTERVIEW_URL}" style="color:#047857;">${INTERVIEW_URL}</a></p>
      <p style="color:#111827;margin:24px 0 0;">Talk soon,<br/><strong>Sam</strong><br/>Apex Financial</p>
      <p style="color:#9ca3af;font-size:12px;margin:16px 0 0;">Instagram ${IG}</p>
    </div>
  </div>`;
  const text = `${first}, you're licensed. The next step is a quick 10 to 15 minute interview call. Book a time: ${INTERVIEW_URL} . Talk soon, Sam, Apex Financial. Instagram ${IG}`;

  if (!resend) return json({ ok: true, skipped: "resend not configured" });
  try {
    const r = await resend.emails.send({
      from: "Apex Financial <notifications@apex-financial.org>",
      to: [String(app.email)],
      subject, html, text,
    });
    return json({ ok: true, sent: true, id: (r as { data?: { id?: string } })?.data?.id ?? null });
  } catch (e) {
    return json({ ok: false, error: String(e).slice(0, 300) }, 200); // 200 so fire-and-forget caller logs no hard failure
  }
});
