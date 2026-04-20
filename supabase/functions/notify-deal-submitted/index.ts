/**
 * notify-deal-submitted
 *
 * Fired by trg_deal_broadcast on every non-draft deal insert.
 * Fans out:
 *   1. Discord embed
 *   2. Email to every licensed, active agent (Resend)
 *   3. SMS to every licensed, active agent (carrier-email gateway — no Twilio needed)
 *   4. Auto-plaque if monthly premium crosses a tier
 *
 * Body: { deal_id: string }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id, idempotency-key",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const CARRIER_GATEWAYS: Record<string, string> = {
  att: "txt.att.net", verizon: "vtext.com", tmobile: "tmomail.net",
  sprint: "messaging.sprintpcs.com", uscellular: "email.uscc.net",
  cricket: "sms.cricketwireless.net", metro: "mymetropcs.com", boost: "sms.myboostmobile.com",
};

function cleanPhone(p: string): string {
  return p.replace(/\D/g, "").slice(-10);
}

function fmt$(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

const PLAQUE_TIERS = [
  { min: 5000, name: "Platinum", emoji: "💎", color: 0x8b5cf6 },
  { min: 3000, name: "Gold",     emoji: "🏆", color: 0xf59e0b },
  { min: 1000, name: "Bronze",   emoji: "🥉", color: 0xcd7f32 },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  try {
    const { deal_id } = await req.json();
    if (!deal_id) {
      return new Response(JSON.stringify({ error: "Missing deal_id" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── 1. Pull deal + agent + carrier ──
    const { data: deal } = await sb.from("deals").select("*").eq("id", deal_id).maybeSingle();
    if (!deal) throw new Error("Deal not found");

    const { data: agent } = await sb
      .from("agents")
      .select("id, user_id, profile:profiles(full_name, email, instagram_handle)")
      .eq("id", deal.agent_id)
      .maybeSingle();

    const { data: carrier } = deal.carrier_id
      ? await sb.from("carriers").select("name").eq("id", deal.carrier_id).maybeSingle()
      : { data: null };

    const agentName   = (agent as any)?.profile?.full_name ?? "An agent";
    const instagram   = (agent as any)?.profile?.instagram_handle ?? null;
    const monthly     = Number(deal.monthly_premium ?? 0);
    const aop         = Number(deal.annual_premium ?? monthly * 12);
    const productSold = deal.product_sold ?? "Life Insurance";
    const carrierName = (carrier as any)?.name ?? "";
    const clientName  = `${deal.client_first_name ?? ""} ${deal.client_last_name ?? ""}`.trim();
    const source      = deal.source ?? "apex";

    // ── 2. Discord embed ──
    const webhookUrl = Deno.env.get("DISCORD_WEBHOOK_URL");
    if (webhookUrl) {
      const igLine = instagram ? `\n📸 @${String(instagram).replace(/^@/, "")}` : "";
      const sourceTag = source === "agent_link" ? "🔗 via Agent Link" : "✨ via APEX";
      const embed = {
        title: "🎯 DEAL CLOSED!",
        description: `**${agentName}** just slammed one shut!${igLine}\n${sourceTag}`,
        color: 0x22d3a5,
        fields: [
          { name: "💰 ALP",       value: fmt$(aop),      inline: true },
          { name: "📅 Monthly",   value: fmt$(monthly),  inline: true },
          { name: "📦 Product",   value: productSold,    inline: true },
          ...(carrierName ? [{ name: "🏢 Carrier", value: carrierName, inline: true }] : []),
          ...(clientName  ? [{ name: "👤 Client",  value: clientName,  inline: true }] : []),
        ],
        footer: { text: "APEX Financial — Who's next?" },
        timestamp: new Date().toISOString(),
      };
      await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ embeds: [embed] }),
      }).catch(err => console.error("Discord post failed:", err));
    }

    // ── 3. Broadcast list: every licensed active agent ──
    const { data: audience } = await sb
      .from("agents")
      .select("id, user_id, profile:profiles(full_name, email, phone, carrier)")
      .eq("is_deactivated", false)
      .eq("is_inactive", false)
      .eq("license_status", "licensed")
      .limit(500);

    const resendKey = Deno.env.get("RESEND_API_KEY");
    const resend    = resendKey ? new Resend(resendKey) : null;

    let emailsSent = 0, smsSent = 0, failed = 0;

    for (const a of (audience ?? []) as Array<{ id: string; user_id: string; profile: { full_name?: string; email?: string; phone?: string; carrier?: string } | null }>) {
      if (a.id === deal.agent_id) continue; // skip the closer
      const theirFirst = a.profile?.full_name?.split(" ")[0] ?? "Agent";
      const email      = a.profile?.email ?? "";
      const phone      = a.profile?.phone ?? "";
      const carrier    = a.profile?.carrier ?? "";

      if (resend && email) {
        try {
          await resend.emails.send({
            from: "APEX Financial <notifications@apex-financial.org>",
            to: [email],
            subject: `🎯 ${agentName} just closed a deal!`,
            html: `<div style="font-family:'DM Sans',Arial,sans-serif;background:#030712;color:#e2e8f0;padding:32px 16px;">
              <div style="max-width:520px;margin:0 auto;background:#0d1526;border:1px solid #22d3a540;border-radius:16px;padding:36px;">
                <div style="text-align:center;font-size:48px;margin-bottom:8px;">🎯</div>
                <h1 style="font-family:Syne,sans-serif;color:#22d3a5;margin:0 0 16px 0;text-align:center;font-size:26px;">${agentName} just closed!</h1>
                <div style="background:#22d3a520;border-radius:12px;padding:20px;text-align:center;margin:20px 0;">
                  <div style="color:#94a3b8;font-size:12px;text-transform:uppercase;letter-spacing:1px;">Monthly Premium</div>
                  <div style="color:#22d3a5;font-size:38px;font-weight:800;margin:4px 0;">${fmt$(monthly)}</div>
                  <div style="color:#e2e8f0;font-size:14px;">${productSold}${carrierName ? " · " + carrierName : ""}</div>
                </div>
                <p style="text-align:center;font-size:16px;line-height:1.7;">Hey ${theirFirst} — the board's moving. Who's next? 🔥</p>
                <div style="text-align:center;margin:28px 0 8px 0;">
                  <a href="https://apex-financial.org/dashboard" style="display:inline-block;background:#22d3a5;color:#030712;font-family:Syne,sans-serif;font-weight:700;padding:14px 28px;border-radius:8px;text-decoration:none;letter-spacing:0.5px;">VIEW IN APEX →</a>
                </div>
                <p style="text-align:center;color:#64748b;font-size:11px;margin:24px 0 0 0;">APEX Financial · Building Empires</p>
              </div>
            </div>`,
          });
          emailsSent++;
          await sb.from("notification_log").insert({
            recipient_user_id: a.user_id, recipient_email: email,
            channel: "email", title: "Deal broadcast",
            message: `${agentName} closed ${fmt$(monthly)}/mo`,
            status: "sent",
            metadata: { kind: "deal_broadcast", deal_id, closer_agent_id: deal.agent_id },
          });
        } catch (e) {
          failed++;
          console.error("email failed:", e);
        }
      }

      if (resend && phone && carrier && CARRIER_GATEWAYS[carrier]) {
        try {
          const smsAddr = `${cleanPhone(phone)}@${CARRIER_GATEWAYS[carrier]}`;
          await resend.emails.send({
            from: "Apex <notifications@apex-financial.org>",
            to: [smsAddr], subject: "",
            text: `🎯 ${agentName} just closed! ${fmt$(monthly)}/mo ${productSold}. Who's next? apex-financial.org`.slice(0, 160),
          });
          smsSent++;
          await sb.from("notification_log").insert({
            recipient_user_id: a.user_id, recipient_phone: phone,
            channel: "sms", title: "Deal broadcast",
            message: `${agentName} closed ${fmt$(monthly)}/mo`,
            status: "sent",
            metadata: { kind: "deal_broadcast", deal_id, gateway: smsAddr },
          });
        } catch (e) {
          failed++;
          console.error("sms failed:", e);
        }
      }
    }

    // ── 4. Auto-plaque on qualifying tiers ──
    const tier = PLAQUE_TIERS.find(t => monthly >= t.min);
    let plaqueResult: { tier: string | null; fired: boolean; detail?: string } = { tier: null, fired: false };
    if (tier) {
      try {
        // Discord fanfare post for the plaque
        if (webhookUrl) {
          await fetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              embeds: [{
                title: `${tier.emoji} ${tier.name} Plaque Unlocked!`,
                description: `**${agentName}** just earned a **${tier.name} Plaque** for a ${fmt$(monthly)}/mo deal!`,
                color: tier.color,
                footer: { text: "APEX Financial · Plaque System" },
                timestamp: new Date().toISOString(),
              }],
            }),
          }).catch(() => {});
        }
        // Fire existing plaque generator if present
        const { error: plaqErr } = await sb.functions.invoke("send-plaque-recognition", {
          body: { agent_id: deal.agent_id, tier: tier.name.toLowerCase(), deal_id, monthly_premium: monthly },
        });
        plaqueResult = { tier: tier.name, fired: !plaqErr, detail: plaqErr?.message };
      } catch (e) {
        plaqueResult = { tier: tier.name, fired: false, detail: String(e) };
      }
    }

    // ── 5. Audit log ──
    await sb.from("deal_sync_log").insert({
      deal_id,
      event_type: "broadcast",
      direction: "notification",
      payload: { agent_name: agentName, monthly, aop, product: productSold, source },
      response: { emails_sent: emailsSent, sms_sent: smsSent, failed, plaque: plaqueResult },
    });

    return new Response(
      JSON.stringify({
        ok: true,
        deal_id,
        agent: agentName,
        emails_sent: emailsSent,
        sms_sent: smsSent,
        failed,
        plaque: plaqueResult,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
