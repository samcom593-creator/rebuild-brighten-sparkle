// 2026-08-17: bumped off supabase-js@2.50.0 — esm.sh resolves transitive deps at
// request time, so that pin pinned nothing underneath it and now fails to resolve
// ws's optional native deps (bufferutil / utf-8-validate). The function died at
// BOOT, before the handler, so every call 500d and nothing recorded a reason.
// Measured 2026-08-17: send-notification 903/903 failures in 24h, poke-pusher
// 164/164, metricool-sync 3/3 — zero 200s. 2.90.1 is the version proven booting.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { gateResend } from "../_shared/resend-gate.ts";
import { createHandler } from "../_shared/handler.ts";
import { jsonResponse } from "../_shared/cors.ts";
import { parseBody, v } from "../_shared/validate.ts";
import { requireSendAuth } from "../_shared/require-send-auth.ts";
import { escapeHtml } from "../_shared/notify-caller-policy.ts";
import { DEPARTED_AGENT_COLUMNS, isDepartedAgent } from "../_shared/departed.ts";

const resend = gateResend(new Resend(Deno.env.get("RESEND_API_KEY")));
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const ADMIN_EMAIL = "info@kingofsales.net";

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
      requireAuth: true,
      rateLimit: { maxRequests: 60, windowSeconds: 60 },
    },
    async (req, ctx) => {
  // PL-LEAK-GATE (2026-10-25): this function was public (verify_jwt=false, no auth) and sends mail or writes rows
  // from caller-supplied ids. Service key always passes; otherwise a signed-in JWT.
  // PL-LEAK-GATE-CENSUS (2026-10-27): "any_authenticated" let any signup mail any agent's manager
  // (cc Sam) a 5,000-character note of its choosing. Notes are written by staff about agents
  // (AgentProfileDrawer), so the floor is "staff": every STAFF_ROLES role, no agents-row fallback.
  const leakGate = await requireSendAuth(req, { floor: "staff" });
  if (!leakGate.ok) return new Response(JSON.stringify({ ok: false, error: leakGate.error }), { status: leakGate.status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });

      if (!ctx.auth) return jsonResponse({ error: "Unauthorized" }, 401);
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
        .select(DEPARTED_AGENT_COLUMNS)
        .eq("id", agent.invited_by_manager_id)
        .maybeSingle();

      if (!managerAgent) throw new Error("Manager not found");
      // A departed manager (terminated or deactivated) is never pushed or mailed: the
      // pointer is kept for attribution after departure, so this reads as no manager.
      if (isDepartedAgent(managerAgent)) {
        return jsonResponse({ success: true, skipped: true });
      }

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
        from: "Galaxy Financial <notifications@apex-financial.org>",
        to: [managerProfile.email],
        cc: [ADMIN_EMAIL],
        subject: `New Note Added: ${agentName}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #3b82f6;">New Agent Note</h2>
            <p>Hi ${escapeHtml(managerProfile.full_name || "Manager")},</p>
            <p>A new note has been added for your agent <strong>${escapeHtml(agentName)}</strong>:</p>
            <div style="background: #f3f4f6; padding: 16px; border-radius: 8px; margin: 16px 0;">
              <p style="margin: 0; color: #374151;">"${escapeHtml(note)}"</p>
            </div>
            <p>Log in to the CRM to view full details and history.</p>
            <br/>
            <p>Best regards,<br/>Galaxy Financial</p>
          </div>
        `,
      });

      console.log(`Note notification sent for agent ${agentId}, CC: ${ADMIN_EMAIL}`);
      return jsonResponse({ success: true });
    }
  )
);
