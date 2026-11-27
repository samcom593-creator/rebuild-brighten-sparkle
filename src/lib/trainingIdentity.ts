import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { WorkflowRpc } from "@/integrations/supabase/workflow-rpcs";
import { resolveAgentIdentity, type AgentIdentity } from "@/lib/agentIdentity";

export type TrainingIdentity = AgentIdentity | { status: "history_review"; agentId: string; count: number; message: string };
type Client = Pick<SupabaseClient<Database>, "from" | "rpc">;

/** A verified absence may provision; a denied or unreadable identity never may. */
export async function resolveTrainingIdentity(client: Client, userId: string | null | undefined): Promise<TrainingIdentity> {
  const identity = await resolveAgentIdentity(client, userId);
  if (identity.status !== "resolved") return identity;
  try {
    const { data, error } = await (client.rpc as unknown as WorkflowRpc)("training_progress_access");
    const access = data as { user_id?: unknown; agent_id?: unknown; alias_progress_count?: unknown } | null;
    if (error || !access || access.user_id !== userId || access.agent_id !== identity.agentId
      || typeof access.alias_progress_count !== "number" || !Number.isSafeInteger(access.alias_progress_count) || access.alias_progress_count < 0) {
      return { status: "error", message: "Your training account access could not be verified. Retry or ask your manager to review access; your progress has not been reset." };
    }
    if (access.alias_progress_count > 0) return { status: "history_review", agentId: identity.agentId, count: access.alias_progress_count,
      message: "Saved training progress exists on a previous agent record. Ask your manager to review that history before continuing. No saved results have been reset or marked complete." };
    return identity;
  } catch {
    return { status: "error", message: "Training access could not be checked. Retry before continuing; your saved results have not been reset." };
  }
}
