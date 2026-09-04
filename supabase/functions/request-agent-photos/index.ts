/**
 * request-agent-photos — email + SMS agents who don't have a profile photo yet.
 *
 * Finds every active agent whose profile has no avatar_url / photo_url
 * AND who has at least one plaque in plaque_awards (i.e. they've earned
 * recognition worth a photo). Sends one nudge email + one SMS per agent
 * with a link to upload.
 *
 * Body: { limit?: number, dry_run?: boolean }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { nanpTenDigits } from "../_shared/nanp-phone.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const UPLOAD_URL = "https://apex-financial.org/dashboard/settings";

const CARRIER_GATEWAYS: Record<string, string> = {
  att: "txt.att.net", verizon: "vtext.com", tmobile: "tmomail.net",
  sprint: "messaging.sprintpcs.com", uscellular: "email.uscc.net",
  cricket: "sms.cricketwireless.net", metro: "mymetropcs.com", boost: "sms.myboostmobile.com",
};


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );
  const resend = new Resend(Deno.env.get("RESEND_API_KEY") ?? "");

  try {
    const body = await req.json().catch(() => ({}));
    const limit = Math.min(Number(body.limit ?? 50), 200);
    const dryRun = !!body.dry_run;

    // Agents without a photo who have earned at least one plaque
    const { data: needsPhoto } = await sb
      .from("agents")
      .select(`id, user_id,
               profile:profiles!agents_profile_id_fkey(full_name, email, phone, carrier, avatar_url, photo_url)`)
      .eq("is_deactivated", false)
      .eq("is_inactive", false)
      .limit(limit);

    const eligible = [] as Array<{ id: string; user_id: string; name: string; email: string; phone: string | null; carrier: string | null }>;
    for (const a of (needsPhoto ?? []) as any[]) {
      const p = a.profile;
      if (!p?.email) continue;
      if (p.avatar_url || p.photo_url) continue; // already has a photo

      // Must have at least one plaque to be worth pinging
      const { count } = await sb
        .from("plaque_awards").select("id", { count: "exact", head: true })
        .eq("agent_id", a.id);
      if (!count || count < 1) continue;

      eligible.push({
        id: a.id, user_id: a.user_id,
        name: p.full_name ?? "Agent",
        email: p.email,
        phone: p.phone ?? null,
        carrier: p.carrier ?? null,
      });
    }

    if (dryRun) {
      return new Response(JSON.stringify({
        ok: true, dry_run: true, would_contact: eligible.length,
        agents: eligible.map(e => ({ name: e.name, has_phone: !!e.phone })),
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let emailsSent = 0, smsSent = 0, failed = 0;

    for (const e of eligible) {
      const first = e.name.split(" ")[0] || "Agent";

      try {
        await resend.emails.send({
          from: "APEX Financial <notifications@apex-financial.org>",
          to: [e.email],
          subject: `${first} — add your photo, we're making your plaque`,
          html: `<div style="font-family:'DM Sans',Arial,sans-serif;background:#030712;color:#e2e8f0;padding:40px 20px;">
  <div style="max-width:540px;margin:0 auto;background:#0d1526;border:1px solid #22d3a540;border-radius:18px;padding:36px;">
    <div style="text-align:center;font-size:56px;margin-bottom:8px;">📸</div>
    <h1 style="color:#22d3a5;font-size:28px;margin:0 0 12px 0;text-align:center;">Hey ${first},</h1>
    <p style="color:#e2e8f0;font-size:15px;line-height:1.7;text-align:center;margin:0 0 24px 0;">
      You've earned plaques in the APEX Hall of Fame. We're building a <strong style="color:#22d3a5;">branded, Instagram-ready award image</strong> for every one of them — but we need your photo to make it look like you.
    </p>
    <div style="background:#22d3a515;border-radius:12px;padding:20px;text-align:center;margin:24px 0;">
      <p style="color:#94a3b8;font-size:13px;margin:0 0 6px 0;letter-spacing:1px;text-transform:uppercase;">Takes 10 seconds</p>
      <p style="color:#fff;font-size:16px;margin:0;">Square headshot, good lighting, clear face.</p>
    </div>
    <div style="text-align:center;margin:28px 0 8px 0;">
      <a href="${UPLOAD_URL}" style="display:inline-block;background:#22d3a5;color:#030712;font-family:ui-sans-serif,system-ui;font-weight:700;padding:16px 36px;border-radius:10px;text-decoration:none;letter-spacing:1px;font-size:14px;">UPLOAD PHOTO →</a>
    </div>
    <p style="color:#64748b;font-size:11px;text-align:center;margin:28px 0 0 0;letter-spacing:2px;">APEX FINANCIAL · BUILDING EMPIRES</p>
  </div>
</div>`,
        });
        emailsSent++;
        await sb.from("notification_log").insert({
          recipient_user_id: e.user_id, recipient_email: e.email,
          channel: "email", title: "Add your photo for plaques",
          message: "Photo upload request", status: "sent",
          metadata: { kind: "photo_request", agent_id: e.id },
        });
      } catch (err) {
        failed++;
      }

      // MP-420: slice(-10) with no length check -- an agent on a non-NANP
      // number was texted at a stranger who happened to own the last ten
      // digits. nanpTenDigits refuses instead of redirecting.
      const photoTen = e.phone ? nanpTenDigits(String(e.phone)) : null;
      if (photoTen && e.carrier && CARRIER_GATEWAYS[e.carrier]) {
        try {
          const gateway = `${photoTen}@${CARRIER_GATEWAYS[e.carrier]}`;
          await resend.emails.send({
            from: "Apex <notifications@apex-financial.org>",
            to: [gateway], subject: "",
            text: `${first} — upload a headshot so we can finish your plaques: ${UPLOAD_URL}`.slice(0, 160),
          });
          smsSent++;
        } catch { failed++; }
      }
    }

    return new Response(JSON.stringify({
      ok: true, eligible: eligible.length, emails_sent: emailsSent, sms_sent: smsSent, failed,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
