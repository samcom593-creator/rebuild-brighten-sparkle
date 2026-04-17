import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { createHandler } from "../_shared/handler.ts";
import { jsonResponse } from "../_shared/cors.ts";
import { parseBody, v } from "../_shared/validate.ts";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const BodySchema = v.object({
  agentId: v.uuid(),
  agentName: v.string({ required: true, max: 128 }),
  deals: v.number({ min: 0, max: 9999 }),
  aop: v.number({ min: 0, max: 99999999 }),
});

async function sendPush(userIds: string[], title: string, body: string, url: string) {
  try {
    const validIds = userIds.filter(Boolean);
    if (validIds.length === 0) return;
    await fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${serviceRoleKey}` },
      body: JSON.stringify({ userIds: validIds, title, body, url }),
    });
    console.log(`Push sent to ${validIds.length} user(s)`);
  } catch (e) {
    console.error("Push failed:", e);
  }
}

Deno.serve(
  createHandler(
    {
      functionName: "notify-deal-alert",
      rateLimit: { maxRequests: 30, windowSeconds: 60 },
    },
    async (req) => {
      const { agentId, agentName, deals, aop } = await parseBody(req, BodySchema);
      console.log(`🚨 DEAL ALERT triggered for ${agentName}: ${deals} deal(s), $${aop} ALP`);

      const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

      const { data: agents, error: agentsError } = await supabase
        .from("agents")
        .select("id, is_deactivated, is_inactive, user_id")
        .eq("is_deactivated", false)
        .eq("is_inactive", false);

      if (agentsError) throw agentsError;

      const userIds = agents?.map(a => a.user_id).filter(Boolean) || [];
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, email, full_name")
        .in("user_id", userIds);

      const profileMap = new Map(profiles?.map(p => [p.user_id, p]) || []);

      const pushTargetIds = agents
        ?.filter(a => a.user_id && a.id !== agentId)
        .map(a => a.user_id)
        .filter(Boolean) as string[];

      const formattedAop = Number(aop).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

      await sendPush(
        pushTargetIds,
        `🚨🔥 DEAL ALERT!`,
        `${agentName} just closed ${deals > 1 ? `${deals} deals` : "a deal"} for $${formattedAop} ALP!`,
        "/numbers"
      );

      const recipients = agents
        ?.filter(a => {
          const profile = profileMap.get(a.user_id);
          return profile?.email && a.id !== agentId;
        })
        .map(a => profileMap.get(a.user_id)?.email)
        .filter(Boolean) as string[];

      console.log(`📧 Sending deal alert to ${recipients.length} agents`);

      if (recipients.length === 0) {
        return jsonResponse({ success: true, sent: 0 });
      }

      const now = new Date();
      const pstTime = now.toLocaleString("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", minute: "2-digit", hour12: true });

      const emailHtml = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin: 0; padding: 0; background-color: #0a0a0a; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #0a0a0a; padding: 40px 20px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 500px; background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%); border-radius: 24px; overflow: hidden; box-shadow: 0 25px 50px -12px rgba(220, 38, 38, 0.5);">
        <tr><td style="padding: 32px 24px; text-align: center;">
          <div style="font-size: 48px; margin-bottom: 8px;">🚨🔥🚨</div>
          <h1 style="color: white; font-size: 28px; font-weight: 900; margin: 0; text-transform: uppercase; letter-spacing: 2px;">DEAL DROPPED!</h1>
        </td></tr>
        <tr><td style="background: rgba(0,0,0,0.2); padding: 32px 24px; text-align: center;">
          <h2 style="color: white; font-size: 32px; font-weight: 900; margin: 0 0 16px 0; text-transform: uppercase;">${agentName.toUpperCase()}</h2>
          <p style="color: rgba(255,255,255,0.9); font-size: 18px; margin: 0;">Just closed ${deals > 1 ? `${deals} deals` : "a deal"} for</p>
          <div style="font-size: 48px; font-weight: 900; color: #fef08a; margin: 16px 0;">$${formattedAop} ALP</div>
          <p style="color: rgba(255,255,255,0.7); font-size: 14px; margin: 0;">📍 ${pstTime} PST</p>
        </td></tr>
        <tr><td style="padding: 24px; text-align: center; background: rgba(0,0,0,0.1);">
          <p style="color: white; font-size: 20px; font-weight: 700; margin: 0 0 20px 0; font-style: italic;">"Can YOU keep up?"</p>
          <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 auto;"><tr><td bgcolor="#fef08a" style="border-radius:12px;"><a href="https://apex-financial.org/numbers" style="display:inline-block;color:#b91c1c;font-size:16px;font-weight:800;text-decoration:none;padding:16px 40px;text-transform:uppercase;letter-spacing:1px;">🎯 LOG MY NUMBERS</a></td></tr></table>
        </td></tr>
        <tr><td style="padding: 20px; text-align: center; background: rgba(0,0,0,0.3);">
          <p style="color: rgba(255,255,255,0.5); font-size: 12px; margin: 0;">APEX Financial • The Hustle Never Stops 🔥</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

      const BATCH_SIZE = 50;
      let sentCount = 0;
      for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
        const batch = recipients.slice(i, i + BATCH_SIZE);
        try {
          await resend.emails.send({
            from: "APEX Financial <notifications@apex-financial.org>",
            bcc: batch,
            to: "sam@apex-financial.org",
            subject: `🚨🔥 DEAL ALERT! ${agentName} just closed! 🔥🚨`,
            html: emailHtml,
          });
          sentCount += batch.length;
        } catch (batchError) {
          console.error(`Failed to send batch:`, batchError);
        }
      }

      console.log(`🎉 Deal alert complete: ${sentCount}/${recipients.length} emails sent`);
      return jsonResponse({ success: true, sent: sentCount, total: recipients.length });
    }
  )
);
