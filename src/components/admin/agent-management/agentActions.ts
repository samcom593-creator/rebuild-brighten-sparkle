import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { AgentProdCard } from "@/components/admin/agent-management/ProductionCard";

export const nudgeAgent = async (agent: AgentProdCard) => {
  const { error } = await supabase.from("agent_tasks").insert({
    agent_id: agent.id,
    title: `Nudge from management`,
    description: `Hey ${agent.name} — checking in. Let's log today's numbers and book some appointments.`,
    due_date: new Date().toISOString().split("T")[0],
    priority: "high",
    status: "pending",
    task_type: "nudge",
    created_at: new Date().toISOString(),
  });
  if (error) { toast.error(`Nudge failed: ${error.message}`); return; }
  toast.success(`Nudge sent to ${agent.name}`);
};

export const createFollowupTask = async (agent: AgentProdCard) => {
  const { error } = await supabase.from("agent_tasks").insert({
    agent_id: agent.id,
    title: `Follow-up: ${agent.name}`,
    description: `Production check-in. Last logged: ${agent.lastLogged || "never"}.`,
    due_date: new Date(Date.now() + 24 * 3600 * 1000).toISOString().split("T")[0],
    priority: agent.status === "red" ? "high" : "medium",
    status: "pending",
    task_type: "followup",
    created_at: new Date().toISOString(),
  });
  if (error) { toast.error(error.message); return; }
  toast.success(`Task created`);
};

export const markTaskComplete = async (taskId: string, agentName: string) => {
  const { error } = await supabase
    .from("agent_tasks")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("id", taskId);
  if (error) { toast.error(error.message); return false; }
  toast.success(`Task for ${agentName} completed`);
  return true;
};

export const bulkNudgeRed = async (agents: AgentProdCard[]) => {
  const redAgents = agents.filter(a => a.status === "red");
  if (redAgents.length === 0) { toast.error("No red agents"); return; }
  const rows = redAgents.map(a => ({
    agent_id: a.id,
    title: `Bulk nudge — get back to work`,
    description: `Inactive ${a.lastLogged ? `since ${a.lastLogged}` : "— never logged"}. Log today's numbers.`,
    due_date: new Date().toISOString().split("T")[0],
    priority: "high",
    status: "pending",
    task_type: "nudge",
    created_at: new Date().toISOString(),
  }));
  const { error } = await supabase.from("agent_tasks").insert(rows);
  if (error) { toast.error(error.message); return; }
  toast.success(`Nudged ${rows.length} red-status agents`);
};

export const bulkTextRed = (agents: AgentProdCard[]) => {
  const redAgents = agents.filter(a => a.status === "red" && a.phone);
  if (redAgents.length === 0) { toast.error("No phones available for red agents"); return; }
  window.location.href = `sms:${redAgents.map(a => a.phone).join(",")}`;
  toast.success(`Opening SMS for ${redAgents.length}`);
};
