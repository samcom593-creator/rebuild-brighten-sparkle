// Onboarding nudge sweep — shakes the stuck-in-onboarding pile.
//
// Target population: agents with is_inactive=true, status=active, zero deals ever.
// These aren't churned producers — they never started.
//
// Cadence (age = now - agents.created_at):
//   3-6 days:   SMS to agent: "what's blocking? reply PRODUCING/STUCK/OUT"
//   7-13 days:  SMS to agent + create agent_task for the assigned manager
//   14-29 days: SMS to manager only: "call {name} today — no production in 14d"
//   30+ days:   flip status='terminated', deactivation_reason='no_initial_production_30d'
//
// Modes:
//   { dry_run: true }           → returns planned actions, sends nothing
//   { dry_run: false, limit: N} → run live, up to N agents
//   no body                      → live full sweep (cron)
// Deploy trigger: commit 00d3138
// Enum fix: commit 2080b3e deactivation_reason

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id, idempotency-key",
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

// admin-protection: d8f4af0 — redeploy trigger

type AgentRow = {
  id: string;
  created_at: string;
  onboarding_stage: string | null;
  invited_by_manager_id: string | null;
  manager_id: string | null;
  profile_id: string | null;
};

function ageDays(created_at: string): number {
  const iso = created_at.replace(/(\.\d{6})\d+/, "$1");
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

type Action = "agent_sms" | "agent_and_manager" | "manager_only" | "terminate";

function planFor(age: number): Action | null {
  if (age >= 3 && age <= 6) return "agent_sms";
  if (age >= 7 && age <= 13) return "agent_and_manager";
  if (age >= 14 && age <= 29) return "manager_only";
  if (age >= 30) return "terminate";
  return null; // <3 days, too early
}

async function getPhoneFor(agent: AgentRow): Promise<{ phone: string | null; name: string; email: string | null }> {
  if (!agent.profile_id) return { phone: null, name: "there", email: null };
  const { data } = await supabase
    .from("profiles")
    .select("full_name, phone, email")
    .eq("id", agent.profile_id)
    .maybeSingle();
  return {
    phone: (data as any)?.phone ?? null,
    name: ((data as any)?.full_name ?? "there").split(" ")[0] || "there",
    email: (data as any)?.email ?? null,
  };
}

async function getManagerContact(managerAgentId: string): Promise<{ phone: string | null; email: string | null; name: string }> {
  const { data: mgrAgent } = await supabase
    .from("agents")
    .select("profile:profiles!agents_profile_id_fkey(full_name, phone, email)")
    .eq("id", managerAgentId)
    .maybeSingle();
  const p = (mgrAgent as any)?.profile;
  return {
    phone: p?.phone ?? null,
    email: p?.email ?? null,
    name: p?.full_name ?? "Manager",
  };
}

async function sendAgentSMS(phone: string, firstName: string, age: number, _agentId: string) {
  const body = age <= 6
    ? `Hey ${firstName}, Sam at APEX. You signed ${age}d ago and haven't booked your first call. Reply PRODUCING / STUCK / OUT and I'll route accordingly.`
    : `${firstName}, it's been ${age} days. Your manager is about to call you. If you want to stay, reply STAY. If you're done, reply OUT.`;
  await supabase.functions.invoke("send-sms-auto-detect", {
    body: { phone, message: body },
  });
}

async function sendManagerSMS(phone: string, mgrName: string, agentName: string, age: number) {
  const firstMgr = (mgrName || "").split(" ")[0] || "Manager";
  const body = `${firstMgr}: ${agentName} is ${age}d in with 0 deals. CALL THEM TODAY or we auto-terminate at day 30.`;
  await supabase.functions.invoke("send-sms-auto-detect", {
    body: { phone, message: body },
  });
}

async function createManagerTask(managerAgentId: string, agentId: string, agentName: string, age: number) {
  // agent_tasks schema: agent_id (task-owner), assigned_by, title, description, due_date, priority, task_type
  const { data: mgrAgent } = await supabase
    .from("agents")
    .select("user_id")
    .eq("id", managerAgentId)
    .maybeSingle();
  const assignedBy = (mgrAgent as any)?.user_id ?? null;
  await supabase.from("agent_tasks").insert({
    agent_id: agentId,
    assigned_by: assignedBy,
    title: `Call ${agentName} — stuck in onboarding ${age}d, zero deals`,
    description: `Auto-created by onboarding-nudge-sweep. If not reactivated by day 30 (currently ${age}d in), agent auto-terminates.`,
    task_type: "onboarding_followup",
    priority: age >= 14 ? "high" : "normal",
    due_date: new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10),
  } as any);
}

async function terminateAgent(agentId: string): Promise<{ ok: boolean; error?: string }> {
  // deactivation_reason is a postgres ENUM with fixed values:
  // 'bad_business' | 'inactive' | 'switched_teams'. Use 'inactive' for
  // 30-day-no-production auto-terminations.
  const { error } = await supabase.from("agents").update({
    status: "terminated",
    is_deactivated: true,
    deactivation_reason: "inactive",
  }).eq("id", agentId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

async function recentlyNudged(agentIds: string[]): Promise<Set<string>> {
  if (agentIds.length === 0) return new Set();
  const since = new Date(Date.now() - 22 * 3600 * 1000).toISOString();
  const { data } = await supabase
    .from("agent_tasks")
    .select("agent_id")
    .in("agent_id", agentIds)
    .eq("task_type", "onboarding_followup")
    .gte("created_at", since);
  return new Set((data ?? []).map((r: any) => r.agent_id as string));
}

type Plan = {
  agent_id: string;
  age_days: number;
  action: Action;
  manager_agent_id: string | null;
};

async function sweep(dryRun: boolean, limit: number) {
  // Candidates: is_inactive=true, status=active. We exclude agents who have
  // closed any deals (those are a different problem — actual churned producers).
  // We ALSO exclude admins and anyone currently managing a team — their agent
  // row exists for DB integrity, not because they're really stuck in onboarding.
  const { data: adminRoles } = await supabase
    .from("user_roles")
    .select("user_id")
    .eq("role", "admin");
  const adminUserIds = new Set((adminRoles ?? []).map((r: any) => r.user_id));

  const { data: managingAgents } = await supabase
    .from("agents")
    .select("invited_by_manager_id, manager_id, switched_to_manager_id");
  const managerAgentIds = new Set<string>();
  for (const row of managingAgents ?? []) {
    for (const k of ["invited_by_manager_id", "manager_id", "switched_to_manager_id"]) {
      const v = (row as any)[k];
      if (v) managerAgentIds.add(v);
    }
  }

  const { data: agents, error } = await supabase
    .from("agents")
    .select("id, user_id, created_at, onboarding_stage, invited_by_manager_id, manager_id, profile_id, total_policies")
    .eq("is_inactive", true)
    .eq("status", "active")
    .eq("total_policies", 0)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw error;

  // Idempotency: skip anyone we've already nudged in the last 22h.
  // terminate is exempt (it's terminal and removes the row from the
  // candidate pool anyway on next sweep).
  const allIds = (agents ?? []).map((a: any) => a.id);
  const alreadyNudged = await recentlyNudged(allIds);

  const plans: Plan[] = [];
  for (const a of (agents ?? []) as (AgentRow & { user_id: string | null })[]) {
    if (a.user_id && adminUserIds.has(a.user_id)) continue; // protect admins
    if (managerAgentIds.has(a.id)) continue;                 // protect managers
    const age = ageDays(a.created_at);
    const action = planFor(age);
    if (!action) continue;
    if (action !== "terminate" && alreadyNudged.has(a.id)) continue;
    plans.push({
      agent_id: a.id,
      age_days: age,
      action,
      manager_agent_id: a.invited_by_manager_id || a.manager_id,
    });
  }

  const summary: Record<string, number> = { agent_sms: 0, agent_and_manager: 0, manager_only: 0, terminate: 0 };
  const results: any[] = [];

  for (const p of plans) {
    summary[p.action]++;
    if (dryRun) { results.push(p); continue; }

    // Refetch contact info (plans only carry ids)
    const { data: agentRow } = await supabase
      .from("agents")
      .select("id, profile_id, invited_by_manager_id, manager_id, created_at")
      .eq("id", p.agent_id)
      .maybeSingle();
    if (!agentRow) { results.push({ ...p, ok: false, error: "agent row vanished" }); continue; }
    const a = agentRow as AgentRow;
    const agentContact = await getPhoneFor(a);
    const age = ageDays(a.created_at);

    try {
      if (p.action === "agent_sms" || p.action === "agent_and_manager") {
        if (agentContact.phone) await sendAgentSMS(agentContact.phone, agentContact.name, age, a.id);
      }
      if (p.action === "agent_and_manager" || p.action === "manager_only") {
        if (p.manager_agent_id) {
          const mgr = await getManagerContact(p.manager_agent_id);
          if (mgr.phone) await sendManagerSMS(mgr.phone, mgr.name, agentContact.name, age);
          await createManagerTask(p.manager_agent_id, a.id, agentContact.name, age);
        }
      }
      if (p.action === "terminate") {
        const r = await terminateAgent(a.id);
        if (!r.ok) { results.push({ ...p, ok: false, error: r.error }); continue; }
      }
      results.push({ ...p, ok: true });
    } catch (e: any) {
      results.push({ ...p, ok: false, error: e?.message ?? String(e) });
    }
  }

  return { processed: plans.length, summary, results };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  let body: { dry_run?: boolean; limit?: number } = {};
  try { body = await req.json(); } catch { /* allow empty */ }

  try {
    const result = await sweep(body.dry_run ?? false, body.limit ?? 500);
    return new Response(JSON.stringify({ mode: body.dry_run ? "dry_run" : "live", ...result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("[onboarding-nudge-sweep] fatal", e);
    return new Response(JSON.stringify({ error: e?.message ?? "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
