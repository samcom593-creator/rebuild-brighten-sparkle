// useNavGrants — per-person permissions the sidebar and Cmd+K honour beyond account mode.
//
// Sold Calls is readable by admins plus the rows in call_access_grants — the database
// decides via can_view_sold_calls(), managed from the Sold Calls page (MP-CALL-ACCESS,
// 2026-11-08; previously hardcoded to Aisha). Admins already see every entry; the grant
// is what puts Sold Calls in a grantee's sidebar, which shows their manager-mode entries.
// Role preview drops the grant so a preview shows what that role sees.
import { useMemo } from "react";
import { useRolePreview } from "@/hooks/useRolePreview";
import { useCanViewSoldCalls } from "@/hooks/useSoldCallKeys";
import type { AgentCloudNavGrant } from "@/components/layout/agentCloudNavigation";

export function useNavGrants(): ReadonlySet<AgentCloudNavGrant> {
  const { isPreviewing } = useRolePreview();
  const { canView } = useCanViewSoldCalls();
  const soldCalls = !isPreviewing && canView;
  return useMemo(() => new Set<AgentCloudNavGrant>(soldCalls ? ["sold_calls"] : []), [soldCalls]);
}
