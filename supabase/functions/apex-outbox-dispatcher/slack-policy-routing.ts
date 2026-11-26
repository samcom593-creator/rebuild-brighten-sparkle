// Keep policy DMs on the existing manager_ops route and receipt ledger.
// Identity is rechecked at delivery so revoked/deactivated agents never get DMs.
export async function policySlackTarget(
  sb: any,
  eventType: string,
  payload: Record<string, unknown>,
  installationId: string,
  purpose: string,
  channelId: string,
): Promise<string | null> {
  if (eventType !== "policy.status_changed" && eventType !== "policy.chargeback") return channelId;
  if (purpose !== "manager_ops") return null;
  if (!payload.slackUserId || !payload.agentId || payload.slackInstallationId !== installationId) return channelId;
  const { data: identity, error } = await sb.from("messaging_identity_links")
    .select("slack_user_id, agents!inner(status)")
    .eq("installation_id", installationId).eq("agent_id", payload.agentId)
    .eq("slack_user_id", payload.slackUserId).eq("verification_status", "verified")
    .eq("agents.status", "active").maybeSingle();
  if (error) throw error;
  return identity && /^[UW][A-Z0-9]{8,}$/.test(identity.slack_user_id)
    ? identity.slack_user_id : channelId;
}
