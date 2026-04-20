/**
 * send-milestone-reward
 *
 * Fires when an agent crosses a monthly ALP milestone (25K / 40K / 75K / 100K).
 * Sends a branded congratulations email via Resend + logs to notification_log.
 *
 * Body:
 * {
 *   agent_id:       string,   // agents.id
 *   milestone:      number,   // 25000 | 40000 | 75000 | 100000
 *   mtd_production: number,   // current MTD ALP
 *   rank?:          number    // optional production rank
 * }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { corsHeaders, jsonResponse, errorResponse } from "../_shared/cors.ts";

const MILESTONE_META: Record<number, { emoji: string; label: string; color: string; headline: string; message: string }> = {
  25000: {
    emoji:   "🥈",
    label:   "$25K Club",
    color:   "#14b8a6",
    headline: "You're in the $25K Club.",
    message:  "25K in a single month puts you ahead of most agents. Momentum is real — keep stacking.",
  },
  40000: {
    emoji:   "🥇",
    label:   "$40K Club",
    color:   "#f59e0b",
    headline: "$40K. That's elite territory.",
    message:  "Less than 10% of agents hit this line. You're officially in the winner's circle.",
  },
  75000: {
    emoji:   "💎",
    label:   "$75K Elite",
    color:   "#8b5cf6",
    headline: "$75K in one month — you're built different.",
    message:  "This is six-figure producer pace. You're lapping the field.",
  },
  100000: {
    emoji:   "👑",
    label:   "$100K Legend",
    color:   "#ec4899",
    headline: "$100K. You are a LEGEND.",
    message:  "$100K months are what empires are built on. You just set the bar for everyone else.",
  },
};

interface MilestoneBody {
  agent_id: string;
  milestone: number;
  mtd_production: number;
  rank?: number;
}

function fmt$(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

function buildEmailHtml(fullName: string, milestone: number, mtd: number, rank?: number): string {
  const meta = MILESTONE_META[milestone];
  const rankLine = rank ? `<p style="color:#94a3b8;font-size:14px;margin:0 0 8px 0;">Production Rank: <strong style="color:${meta.color};">#${rank}</strong></p>` : "";

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;margin:0;padding:0;background-color:#0a0f1a;">
  <div style="max-width:600px;margin:0 auto;padding:40px 20px;">
    <div style="background:linear-gradient(135deg,#0d1526 0%,#1a2a4a 100%);border-radius:16px;padding:40px;border:1px solid ${meta.color}66;">

      <div style="text-align:center;margin-bottom:16px;">
        <span style="font-size:80px;line-height:1;">${meta.emoji}</span>
      </div>

      <div style="text-align:center;background:${meta.color}22;border:1px solid ${meta.color};border-radius:999px;padding:6px 16px;display:inline-block;margin:0 auto 20px auto;">
        <span style="color:${meta.color};font-weight:bold;font-size:12px;letter-spacing:1px;text-transform:uppercase;">${meta.label}</span>
      </div>

      <h1 style="color:${meta.color};font-size:30px;margin:0 0 8px 0;text-align:center;font-weight:800;">
        ${meta.headline}
      </h1>
      <h2 style="color:#ffffff;font-size:24px;margin:0 0 24px 0;text-align:center;font-weight:600;">
        ${fullName}
      </h2>

      <div style="background:${meta.color}22;border-radius:12px;padding:28px;margin:24px 0;text-align:center;">
        <p style="color:#94a3b8;font-size:13px;margin:0 0 6px 0;letter-spacing:0.5px;text-transform:uppercase;">Month-to-Date Production</p>
        <p style="color:${meta.color};font-size:44px;font-weight:800;margin:0;line-height:1;">${fmt$(mtd)}</p>
        ${rankLine}
      </div>

      <p style="color:#e2e8f0;font-size:16px;line-height:1.7;text-align:center;margin:24px 0;">
        ${meta.message}
      </p>

      <div style="background:linear-gradient(135deg,${meta.color}33 0%,${meta.color}11 100%);border-radius:12px;padding:18px;margin:24px 0;text-align:center;">
        <p style="color:#ffffff;font-size:14px;font-weight:600;margin:0 0 4px 0;">📸 Post it. Tag us.</p>
        <p style="color:#94a3b8;font-size:12px;margin:0;">Screenshot this and share to your stories — @apex.financial</p>
      </div>

      <div style="border-top:1px solid rgba(148,163,184,0.2);padding-top:20px;margin-top:28px;text-align:center;">
        <p style="color:#64748b;font-size:11px;margin:0;">APEX Financial Empire · Building Empires, Protecting Families</p>
      </div>

    </div>
  </div>
</body>
</html>`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST")   return errorResponse("Method not allowed", 405);

  try {
    const body = (await req.json()) as MilestoneBody;
    const { agent_id, milestone, mtd_production, rank } = body;

    if (!agent_id || !milestone || !mtd_production) {
      return errorResponse("Missing required fields: agent_id, milestone, mtd_production", 400);
    }
    if (!MILESTONE_META[milestone]) {
      return errorResponse(`Invalid milestone: ${milestone}. Must be one of ${Object.keys(MILESTONE_META).join(", ")}`, 400);
    }

    const sb = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    // Idempotency: if a success record exists for (agent, milestone, current month), bail
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const { data: existing } = await sb
      .from("notification_log")
      .select("id")
      .eq("status", "sent")
      .eq("channel", "email")
      .contains("metadata", { kind: "deal_milestone", agent_id, milestone })
      .gte("created_at", monthStart.toISOString())
      .limit(1);

    if (existing && existing.length > 0) {
      return jsonResponse({ ok: true, skipped: "already_sent_this_month", agent_id, milestone });
    }

    // Resolve agent → user → profile → email
    const { data: agent } = await sb.from("agents").select("user_id, profile_id").eq("id", agent_id).maybeSingle();
    if (!agent) return errorResponse("Agent not found", 404);

    const { data: profile } = await sb
      .from("profiles")
      .select("full_name, email, phone, carrier")
      .eq("user_id", (agent as { user_id: string }).user_id)
      .maybeSingle();

    const fullName = (profile as { full_name?: string })?.full_name ?? "Agent";
    const email    = (profile as { email?: string })?.email ?? "";
    const phone    = (profile as { phone?: string })?.phone ?? "";
    const carrier  = (profile as { carrier?: string })?.carrier ?? "";

    if (!email) {
      await sb.from("notification_log").insert({
        recipient_user_id: (agent as { user_id: string }).user_id,
        channel:  "email",
        title:    `Milestone ${milestone}`,
        message:  `Milestone email skipped — no email on file`,
        status:   "failed",
        error_message: "No email on profile",
        metadata: { kind: "deal_milestone", agent_id, milestone, mtd_production },
      });
      return errorResponse("No email on profile", 400);
    }

    const meta = MILESTONE_META[milestone];
    const resend = new Resend(Deno.env.get("RESEND_API_KEY") ?? "");

    try {
      const result = await resend.emails.send({
        from:    "APEX Financial <notifications@apex-financial.org>",
        to:      [email],
        cc:      ["sam@apex-financial.org"],
        subject: `${meta.emoji} ${meta.headline} — ${fmt$(mtd_production)} this month`,
        html:    buildEmailHtml(fullName, milestone, mtd_production, rank),
      });

      await sb.from("notification_log").insert({
        recipient_user_id: (agent as { user_id: string }).user_id,
        recipient_email:   email,
        channel:  "email",
        title:    `${meta.label} Milestone`,
        message:  `${fullName} hit ${meta.label} with ${fmt$(mtd_production)} MTD`,
        status:   "sent",
        metadata: {
          kind: "deal_milestone",
          agent_id, milestone, mtd_production, rank,
          resend_id: (result as { data?: { id?: string } })?.data?.id ?? null,
        },
      });

      // ── SMS via Google-style carrier email gateway ──
      const smsText = `${meta.emoji} ${meta.label}! You just crossed ${fmt$(mtd_production)} MTD. Legendary. — APEX`;
      let smsResult: { ok: boolean; detail: string } = { ok: false, detail: "no phone on profile" };

      if (phone) {
        try {
          const smsFn = carrier ? "send-sms-via-email" : "send-sms-auto-detect";
          const smsBody = carrier
            ? { phone, carrier, message: smsText, agentId: agent_id }
            : { phone, message: smsText };

          const { data: smsData, error: smsErr } = await sb.functions.invoke(smsFn, { body: smsBody });

          if (smsErr) {
            smsResult = { ok: false, detail: smsErr.message || String(smsErr) };
          } else {
            smsResult = { ok: true, detail: carrier ? `sent via ${carrier}` : `auto-detect: ${(smsData as { carrierSelected?: string })?.carrierSelected ?? "tried all gateways"}` };
          }
        } catch (smsErr) {
          smsResult = { ok: false, detail: String(smsErr) };
        }
      }

      // Log the milestone SMS attempt (on top of any internal logging done by the sms function)
      await sb.from("notification_log").insert({
        recipient_user_id: (agent as { user_id: string }).user_id,
        recipient_phone:   phone || null,
        channel:  "sms",
        title:    `${meta.label} Milestone`,
        message:  smsText,
        status:   smsResult.ok ? "sent" : "failed",
        error_message: smsResult.ok ? null : smsResult.detail,
        metadata: {
          kind: "deal_milestone",
          agent_id, milestone, mtd_production,
          gateway: smsResult.detail,
          via: carrier || "auto-detect",
        },
      });

      return jsonResponse({
        ok: true,
        milestone,
        mtd_production,
        email,
        sms: smsResult,
      });
    } catch (emailErr) {
      const msg = String(emailErr);
      await sb.from("notification_log").insert({
        recipient_user_id: (agent as { user_id: string }).user_id,
        recipient_email:   email,
        channel:  "email",
        title:    `${meta.label} Milestone`,
        message:  `Email send failed`,
        status:   "failed",
        error_message: msg,
        metadata: { kind: "deal_milestone", agent_id, milestone, mtd_production },
      });
      return errorResponse(`Email failed: ${msg}`, 500);
    }
  } catch (err) {
    return errorResponse(`Unhandled: ${String(err)}`, 500);
  }
});

// redeploy-bump: 1776703450
