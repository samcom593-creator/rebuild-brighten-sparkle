import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" } });
const url = Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const resendKey = Deno.env.get("RESEND_API_KEY") ?? "";
if (!url || !serviceKey) throw new Error("Missing Supabase configuration");
const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

function phoenixToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Phoenix", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character] ?? character));
}
async function allowedAgentIds(userId: string, roles: Set<string>) {
  if (roles.has("admin")) return null;
  const { data: roots, error: rootError } = await admin.from("agents").select("id").eq("user_id", userId);
  if (rootError) throw rootError;
  const allowed = new Set((roots ?? []).map((row) => String(row.id)));
  if (roles.has("manager") && allowed.size) {
    const { data: agents, error } = await admin.from("agents").select("id,manager_id,invited_by_manager_id").limit(3000);
    if (error) throw error;
    let changed = true;
    while (changed) {
      changed = false;
      for (const agent of agents ?? []) {
        if (allowed.has(agent.id)) continue;
        if ((agent.manager_id && allowed.has(agent.manager_id)) || (agent.invited_by_manager_id && allowed.has(agent.invited_by_manager_id))) {
          allowed.add(agent.id); changed = true;
        }
      }
    }
  }
  return allowed;
}
async function sendPush(userIds: string[], title: string, body: string) {
  if (!userIds.length) return { skipped: true };
  const response = await fetch(`${url}/functions/v1/send-push-notification`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
    body: JSON.stringify({ userIds: [...new Set(userIds)], title, body, url: "/numbers" }),
  });
  if (!response.ok) throw new Error(`Push failed (${response.status})`);
  return { status: response.status };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  let claimId: string | null = null;
  try {
    const header = req.headers.get("Authorization") ?? "";
    if (!header.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);
    const { data: auth, error: authError } = await admin.auth.getUser(header.slice(7));
    if (authError || !auth.user?.id) return json({ error: "invalid token" }, 401);
    const { data: roleRows, error: roleError } = await admin.from("user_roles").select("role").eq("user_id", auth.user.id);
    if (roleError) throw roleError;
    const roles = new Set((roleRows ?? []).map((row) => String(row.role)));
    if (!["admin", "manager", "agent"].some((role) => roles.has(role))) return json({ error: "forbidden" }, 403);

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const agentId = String(body.agentId ?? "");
    const productionDate = String(body.date ?? phoenixToday());
    if (!/^[0-9a-f-]{36}$/i.test(agentId) || !/^\d{4}-\d{2}-\d{2}$/.test(productionDate)) return json({ error: "invalid request" }, 400);
    const allowed = await allowedAgentIds(auth.user.id, roles);
    if (allowed !== null && !allowed.has(agentId)) return json({ error: "forbidden" }, 403);

    const { data: claim, error: claimError } = await admin.from("production_submission_notifications")
      .insert({ agent_id: agentId, production_date: productionDate, status: "pending" }).select("id").maybeSingle();
    if (claimError?.code === "23505") return json({ success: true, replay: true });
    if (claimError || !claim) throw claimError ?? new Error("Unable to claim notification");
    claimId = claim.id;

    const [{ data: agent, error: agentError }, { data: daily, error: dailyError }, { data: production, error: productionError }] = await Promise.all([
      admin.from("agents").select("display_name,user_id,manager_id,invited_by_manager_id").eq("id", agentId).single(),
      admin.from("daily_production").select("presentations").eq("agent_id", agentId).eq("production_date", productionDate).maybeSingle(),
      admin.from("v_production_unified").select("annual_premium").eq("agent_id", agentId).eq("posted_date", productionDate).limit(3000),
    ]);
    if (agentError) throw agentError;
    if (dailyError) throw dailyError;
    if (productionError) throw productionError;
    const deals = production?.length ?? 0;
    const alp = (production ?? []).reduce((sum, row) => sum + Number(row.annual_premium || 0), 0);
    const agentName = String(agent.display_name || "Agent");
    const managerId = agent.manager_id || agent.invited_by_manager_id;
    let managerUserId: string | null = null;
    let managerEmail: string | null = null;
    if (managerId) {
      const { data: manager } = await admin.from("agents").select("user_id").eq("id", managerId).maybeSingle();
      managerUserId = manager?.user_id ?? null;
      if (managerUserId) {
        const { data: profile } = await admin.from("profiles").select("email").eq("user_id", managerUserId).maybeSingle();
        managerEmail = profile?.email ?? null;
      }
    }
    const push = await sendPush([agent.user_id, managerUserId].filter(Boolean) as string[], "Production submitted", `${agentName}: ${deals} policies, $${alp.toLocaleString()} ALP`);
    let email: unknown = { skipped: true };
    if (resendKey) {
      email = await new Resend(resendKey).emails.send({
        from: "APEX Production <notifications@apex-financial.org>",
        to: [...new Set(["sam@apex-financial.org", managerEmail].filter(Boolean))] as string[],
        subject: `${agentName} | Production report`,
        html: `<h1>Production report</h1><p><strong>${escapeHtml(agentName)}</strong></p><p>${deals} policies · $${alp.toLocaleString()} ALP · ${Number(daily?.presentations || 0)} presentations</p><p>${productionDate} · America/Phoenix</p>`,
      });
    }
    await admin.from("production_submission_notifications").update({ status: "delivered", completed_at: new Date().toISOString(), receipt: { push, email, deals, alp } }).eq("id", claim.id);
    return json({ success: true, deals, alp, source: "v_production_unified" });
  } catch (error) {
    console.error("notify-production-submitted error", error);
    if (claimId) await admin.from("production_submission_notifications").update({ status: "unknown_outcome", completed_at: new Date().toISOString() }).eq("id", claimId);
    return json({ error: "request failed" }, 500);
  }
});
