import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { createHandler } from "../_shared/handler.ts";
import { jsonResponse } from "../_shared/cors.ts";
import { parseBody, v } from "../_shared/validate.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const STAGE_INFO: Record<string, { label: string; description: string; emoji: string; nextSteps: string[] }> = {
  onboarding: { label: "Onboarding", description: "Initial paperwork & contracting", emoji: "📋", nextSteps: ["Complete your contracting paperwork", "Gather required documents", "Schedule your onboarding call"] },
  training_online: { label: "In Course", description: "Product training & certification", emoji: "📚", nextSteps: ["Watch all training videos", "Pass the quiz assessments", "Complete the certification modules"] },
  in_field_training: { label: "In-Field Training", description: "Shadowing & ride-alongs", emoji: "🎯", nextSteps: ["Shadow experienced agents", "Practice presentations", "Attend daily meetings"] },
  evaluated: { label: "Live", description: "Active in the field", emoji: "🚀", nextSteps: ["Log your daily numbers", "Close deals", "Build your referral network"] },
};

async function sendPush(userIds: string[], title: string, body: string, url: string) {
  try {
    const validIds = userIds.filter(Boolean);
    if (validIds.length === 0) return;
    await fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${serviceRoleKey}` },
      body: JSON.stringify({ userIds: validIds, title, body, url }),
    });
  } catch (e) {
    console.error("Push failed:", e);
  }
}

const BodySchema = v.object({
  agentId: v.uuid(),
  previousStage: v.string({ max: 64 }),
  newStage: v.string({ required: true, max: 64 }),
  agentName: v.string({ max: 128 }),
});

Deno.serve(
  createHandler(
    {
      functionName: "notify-stage-change",
      rateLimit: { maxRequests: 60, windowSeconds: 60 },
    },
    async (req) => {
      const { agentId, newStage, agentName } = await parseBody(req, BodySchema);

      if (!agentId || !newStage) throw new Error("Missing required fields");

      const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
      const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

      const { data: agent } = await supabase.from("agents").select("user_id, invited_by_manager_id").eq("id", agentId).maybeSingle();
      if (!agent?.user_id) throw new Error("Agent not found");

      const { data: profile } = await supabase.from("profiles").select("email, full_name").eq("user_id", agent.user_id).maybeSingle();
      if (!profile?.email) throw new Error("Profile email not found");

      let managerEmail: string | null = null;
      if (agent.invited_by_manager_id) {
        const { data: managerAgent } = await supabase.from("agents").select("user_id").eq("id", agent.invited_by_manager_id).maybeSingle();
        if (managerAgent?.user_id) {
          const { data: managerProfile } = await supabase.from("profiles").select("email").eq("user_id", managerAgent.user_id).maybeSingle();
          managerEmail = managerProfile?.email || null;
        }
      }

      const stageInfo = STAGE_INFO[newStage] || { label: newStage, description: "", emoji: "📌", nextSteps: [] };
      const displayName = agentName || profile.full_name || "Agent";
      const isPromotion = ["in_field_training", "evaluated"].includes(newStage);

      await sendPush(
        [agent.user_id],
        `${stageInfo.emoji} ${isPromotion ? "Congratulations!" : "Stage Update"}`,
        `You're now in: ${stageInfo.label} — ${stageInfo.description}`,
        newStage === "evaluated" ? "/agent-portal" : "/onboarding-course"
      );

      const emailHtml = `
<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #0a0a0a;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: ${isPromotion ? "linear-gradient(135deg, #10b981 0%, #059669 100%)" : "linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)"}; border-radius: 16px 16px 0 0; padding: 40px 30px; text-align: center;">
      <div style="font-size: 64px; margin-bottom: 16px;">${stageInfo.emoji}</div>
      <h1 style="color: white; margin: 0; font-size: 28px; font-weight: bold;">${isPromotion ? "🎉 Congratulations!" : "Stage Update"}</h1>
      <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0 0; font-size: 16px;">${displayName}</p>
    </div>
    <div style="background: #1a1a1a; padding: 30px; border-radius: 0 0 16px 16px; border: 1px solid #333; border-top: none;">
      <div style="text-align: center; margin-bottom: 24px;">
        <h2 style="color: white; margin: 0 0 8px 0; font-size: 24px;">You're now in: <span style="color: ${isPromotion ? "#10b981" : "#3b82f6"};">${stageInfo.label}</span></h2>
        <p style="color: #999; margin: 0; font-size: 14px;">${stageInfo.description}</p>
      </div>
      <div style="background: #0a0a0a; border-radius: 12px; padding: 20px; margin-top: 24px;">
        <h3 style="color: white; margin: 0 0 16px 0; font-size: 16px;">📋 Your Next Steps:</h3>
        <ul style="color: #ccc; margin: 0; padding-left: 20px; line-height: 1.8;">
          ${stageInfo.nextSteps.map((step: string) => `<li>${step}</li>`).join("")}
        </ul>
      </div>
      ${newStage === "evaluated" ? `
      <div style="margin-top: 24px; text-align: center;">
        <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 auto;">
          <tr><td align="center" bgcolor="#10b981" style="border-radius:12px;">
            <a href="https://apex-financial.org/agent-portal" style="display:inline-block;color:#ffffff;font-size:16px;font-weight:bold;padding:14px 32px;text-decoration:none;">🎯 Access Your Portal</a>
          </td></tr>
        </table>
      </div>` : ""}
      <div style="margin-top: 32px; padding-top: 24px; border-top: 1px solid #333; text-align: center;">
        <p style="color: #666; font-size: 12px; margin: 0;">Keep pushing forward! The Apex Financial team is here to support you.</p>
      </div>
    </div>
  </div>
</body></html>`;

      const ccList = ["sam@apex-financial.org"];
      if (managerEmail && managerEmail !== profile.email && !ccList.includes(managerEmail)) {
        ccList.push(managerEmail);
      }

      const { error: emailError } = await resend.emails.send({
        from: "APEX Financial <notifications@apex-financial.org>",
        to: [profile.email],
        cc: ccList,
        subject: `${stageInfo.emoji} ${isPromotion ? "Congratulations!" : "Update:"} You're now ${stageInfo.label}!`,
        html: emailHtml,
      });

      if (emailError) throw emailError;

      console.log(`Stage change email sent to ${profile.email} for stage ${newStage}`);
      return jsonResponse({ success: true });
    }
  )
);
