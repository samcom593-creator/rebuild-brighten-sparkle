// useNavGrants — per-person permissions the sidebar and Cmd+K honour beyond account mode.
//
// Sold Calls is readable by admins and Aisha only (can_view_sold_calls in the database). Admins
// already see every entry; the grant is what puts Sold Calls in Aisha's sidebar, which shows her
// manager-mode entries. Role preview drops the grant so a preview shows what that role sees.
import { useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useRolePreview } from "@/hooks/useRolePreview";
import { canViewSoldCalls } from "@/hooks/useSoldCallKeys";
import type { AgentCloudNavGrant } from "@/components/layout/agentCloudNavigation";

export function useNavGrants(): ReadonlySet<AgentCloudNavGrant> {
  const { user, isAdmin } = useAuth();
  const { isPreviewing } = useRolePreview();
  const soldCalls = !isPreviewing && canViewSoldCalls(Boolean(isAdmin), user?.id);
  return useMemo(() => new Set<AgentCloudNavGrant>(soldCalls ? ["sold_calls"] : []), [soldCalls]);
}
