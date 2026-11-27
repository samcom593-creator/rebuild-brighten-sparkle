export type IdentityReply = { data: unknown; error: unknown };

/** Caller-scoped RPC evidence, never the service client's auth context. */
export function completionOwner(reply: IdentityReply, userId: string, agentId: string) {
  if (reply.error) return { ok: false, status: 403, error: "Your canonical training account could not be verified." };
  const identity = reply.data as { user_id?: unknown; agent_id?: unknown; agent_ids?: unknown } | null;
  if (!identity || identity.user_id !== userId || identity.agent_id !== agentId || !Array.isArray(identity.agent_ids) || !identity.agent_ids.includes(agentId)) {
    return { ok: false, status: 403, error: "You can only report your own canonical course completion." };
  }
  return { ok: true, status: 200 };
}

export async function confirmFieldTrainingStage(db: { from: (name: string) => any }, agentId: string) {
  const { data, error } = await db.from("agents").update({ onboarding_stage: "in_field_training" })
    .eq("id", agentId).select("id, onboarding_stage").single();
  if (error || data?.id !== agentId || data?.onboarding_stage !== "in_field_training") throw new Error("The training stage update could not be confirmed.");
}
