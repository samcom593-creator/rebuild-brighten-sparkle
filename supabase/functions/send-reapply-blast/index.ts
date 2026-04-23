/**
 * send-reapply-blast — "The doors are back open" campaign.
 *
 * Pulls warm applicants from the last 30 days (status in new/no_pickup/
 * reviewing/interview, not terminated), sends personalized email via Resend
 * + SMS via send-sms-auto-detect. Two copy variants (licensed vs unlicensed)
 * and a dedup guard via notification_log.metadata.campaign.
 *
 * Invocation:
 *   POST /functions/v1/send-reapply-blast
 *   body: { dryRun?: boolean, limit?: number }
 *
 * Returns: { sent_email, sent_sms, skipped_dedup, failed, preview? }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const CAMPAIGN = "reapply_doors_open_2026_04_23";
const SUBJECT  = "The doors are back open.";
const FROM     = "Sam @ APEX Financial <sam@apex-financial.org>";
const SB_URL   = Deno.env.get("SUPABASE_URL")!;
const SB_SRV   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND   = new Resend(Deno.env.get("RESEND_API_KEY"));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function buildEmail(firstName: string, licensed: boolean): { html: string; text: string } {
  const cta = licensed
    ? "We'll walk you through contracts today and have you writing deals by Friday."
    : "We fund your license course. You pass the state exam, you're writing deals inside 30 days.";

  const text = [
    `Hey ${firstName},`,
    ``,
    `When you applied to APEX a few weeks back, we weren't taking anyone new. Doors are back open this week.`,
    ``,
    `This team is not for people looking for a job. It's for people who want to out-earn everyone they went to high school with. If that's not you, delete this.`,
    ``,
    `If it IS you:`,
    ``,
    `→ Call me now: (469) 767-6068`,
    `→ Or reply to this email with "I'm in"`,
    ``,
    cta,
    ``,
    `— Sam`,
    `APEX Financial`,
  ].join("\n");

  const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0b1220;line-height:1.6">
<p>Hey ${firstName},</p>
<p>When you applied to APEX a few weeks back, we weren't taking anyone new. <strong>Doors are back open this week.</strong></p>
<p>This team is not for people looking for a job. It's for people who want to out-earn everyone they went to high school with. If that's not you, delete this.</p>
<p>If it <em>is</em> you:</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:18px 0">
<tr><td style="padding:12px 22px;background:#0f172a;border-radius:8px">
  <a href="tel:+14697676068" style="color:#fff;font-weight:700;text-decoration:none;font-size:16px">📞 Call (469) 767-6068</a>
</td></tr>
</table>
<p style="color:#475569;font-size:14px">Or reply to this email with <strong>"I'm in"</strong></p>
<p style="margin-top:24px">${cta}</p>
<p>— Sam<br><span style="color:#64748b;font-size:13px">APEX Financial</span></p>
</div>`;

  return { html, text };
}

function buildSms(firstName: string, licensed: boolean): string {
  return licensed
    ? `Sam from APEX. Doors are back open — we're pulling the gloves back on. You're already licensed; we want you carrying our flag. Call (469) 767-6068 or reply YES to reapply.`
    : `Sam from APEX. Doors are back open — we're hiring again. No license? We fund your course. Call (469) 767-6068 or reply YES and we'll get you on a call today.`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const sb = createClient(SB_URL, SB_SRV, { auth: { persistSession: false } });
  const body = await req.json().catch(() => ({} as any));
  const dryRun: boolean = !!body.dryRun;
  const limit:  number  = Math.min(Number(body.limit ?? 999), 999);

  // 1) Pull cohort
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data: rows, error } = await sb
    .from("applications")
    .select("id, first_name, last_name, email, phone, license_status, created_at")
    .gte("created_at", cutoff)
    .is("terminated_at", null)
    .in("status", ["new", "no_pickup", "reviewing", "interview"])
    .not("email", "is", null)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 2) Dedup: pull existing campaign sends
  const { data: already } = await sb
    .from("notification_log")
    .select("recipient_email")
    .eq("metadata->>campaign" as any, CAMPAIGN)
    .eq("status", "sent");
  const sentSet = new Set((already ?? []).map((r: any) => String(r.recipient_email).toLowerCase()));

  let sentEmail = 0, sentSms = 0, skipped = 0, failed = 0;
  const errors: Array<{ email: string; where: string; msg: string }> = [];
  const preview: any[] = [];

  for (const r of rows ?? []) {
    if (!r.email) { failed++; continue; }
    if (sentSet.has(String(r.email).toLowerCase())) { skipped++; continue; }

    const firstName = (r.first_name ?? "").toString().trim() || "there";
    const licensed  = r.license_status === "licensed";
    const { html, text } = buildEmail(firstName, licensed);
    const sms = buildSms(firstName, licensed);

    if (dryRun) {
      preview.push({ id: r.id, email: r.email, phone: r.phone, firstName, licensed });
      continue;
    }

    // Email via Resend
    try {
      const out = await RESEND.emails.send({
        from: FROM, to: [r.email], subject: SUBJECT, html, text,
        headers: { "List-Unsubscribe": "<mailto:unsubscribe@apex-financial.org>" },
      });
      if ((out as any)?.error) throw new Error((out as any).error.message ?? String((out as any).error));
      sentEmail++;
    } catch (e: any) {
      failed++;
      errors.push({ email: r.email, where: "email", msg: e?.message ?? String(e) });
      continue; // don't SMS if email failed — lets us retry this record clean
    }

    // SMS via send-sms-auto-detect
    if (r.phone) {
      try {
        const smsRes = await fetch(`${SB_URL}/functions/v1/send-sms-auto-detect`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${SB_SRV}`,
            apikey: SB_SRV,
          },
          body: JSON.stringify({ phone: r.phone, message: sms, applicationId: r.id }),
        });
        const json = await smsRes.json().catch(() => ({}));
        if (smsRes.ok && (json.successCount > 0 || json.success === true)) sentSms++;
        else errors.push({ email: r.email, where: "sms", msg: `${smsRes.status}: ${JSON.stringify(json).slice(0, 200)}` });
      } catch (e: any) {
        errors.push({ email: r.email, where: "sms", msg: e?.message ?? String(e) });
      }
    }

    // Log for dedup
    await sb.from("notification_log").insert({
      recipient_email: r.email,
      channel: "email",
      title: SUBJECT,
      message: "reapply blast",
      status: "sent",
      metadata: { campaign: CAMPAIGN, applicationId: r.id, licensed },
    });

    await sleep(260); // ~4/sec, friendly to Resend + SMS gateway
  }

  return new Response(
    JSON.stringify({
      campaign: CAMPAIGN,
      dryRun,
      cohort: rows?.length ?? 0,
      sent_email: sentEmail,
      sent_sms: sentSms,
      skipped_dedup: skipped,
      failed,
      errors: errors.slice(0, 10),
      preview: dryRun ? preview : undefined,
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
