import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { createHandler } from "../_shared/handler.ts";
import { jsonResponse } from "../_shared/cors.ts";
import { parseBody, v } from "../_shared/validate.ts";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const ADMIN_EMAIL = "sam@apex-financial.org";

const BodySchema = v.object({
  agentId: v.uuid(),
  note: v.string({ required: true, min: 1, max: 5000 }),
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
  } catch (e) {
    console.error("Push failed:", e);
  }
}

Deno.serve(
  createHandler(
    {
      functionName: "notify-notes-added",
      rateLimit: { maxRequests: 60, windowSeconds: 60 },
    },
    async (req) => {
      const { agentId, note } = await parseBody(req, BodySchema);

      const supabase = createClient(supabaseUrl, serviceRoleKey, {
        auth: { persistSession: false },
      });

      const { data: agent, error: agentError } = await supabase
        .from("agents")
        .select("id, user_id, invited_by_manager_id")
        .eq("id", agentId)
        .maybeSingle();

      if (agentError || !agent) throw new Error("Agent not found");

      const { data: agentProfile } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("user_id", agent.user_id)
        .maybeSingle();

      if (!agent.invited_by_manager_id) {
        return jsonResponse({ success: true, skipped: true });
      }

      const { data: managerAgent } = await supabase
        .from("agents")
        .select("user_id")
        .eq("id", agent.invited_by_manager_id)
        .maybeSingle();

      if (!managerAgent) throw new Error("Manager not found");

      const { data: managerProfile } = await supabase
        .from("profiles")
        .select("full_name, email")
        .eq("user_id", managerAgent.user_id)
        .maybeSingle();

      if (!managerProfile?.email) throw new Error("Manager email not found");

      const agentName = agentProfile?.full_name || "Agent";

      // Send push to manager
      await sendPush(
        [managerAgent.user_id],
        `📝 New Note: ${agentName}`,
        note.substring(0, 100),
        "/dashboard/applicants"
      );

      await resend.emails.send({
        from: "Apex Financial <notifications@apex-financial.org>",
        to: [managerProfile.email],
        cc: [ADMIN_EMAIL],
        subject: `New Note Added: ${agentName}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #3b82f6;">New Agent Note</h2>
            <p>Hi ${managerProfile.full_name || "Manager"},</p>
            <p>A new note has been added for your agent <strong>${agentName}</strong>:</p>
            <div style="background: #f3f4f6; padding: 16px; border-radius: 8px; margin: 16px 0;">
              <p style="margin: 0; color: #374151;">"${note}"</p>
            </div>
            <p>Log in to the CRM to view full details and history.</p>
            <br/>
            <p>Best regards,<br/>Apex Financial</p>
          </div>
        `,
      });

      console.log(`Note notification sent for agent ${agentId}, CC: ${ADMIN_EMAIL}`);
      return jsonResponse({ success: true });
    }
  )
);
