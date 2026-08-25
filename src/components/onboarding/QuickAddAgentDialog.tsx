import type { ReactNode } from "react";

import { AddAgentModal } from "@/components/dashboard/AddAgentModal";

/**
 * Compatibility wrapper for older recruiting surfaces.
 *
 * There used to be a second "Add Agent" implementation here that wrote only
 * to apex_toolkit_agents. Those people did not receive a canonical profile,
 * login, team placement, training, or contracting record, so their information
 * disappeared on the rest of the site. Every Add Agent button now opens the
 * same licensed/unlicensed workflow and writes through the canonical add-agent
 * function.
 */
export function QuickAddAgentDialog({
  trigger,
  onAgentAdded,
}: {
  trigger?: ReactNode;
  onAgentAdded?: (agentId: string) => void;
}) {
  return (
    <AddAgentModal
      trigger={trigger}
      onAgentAdded={(agentId) => {
        if (agentId) onAgentAdded?.(agentId);
      }}
    />
  );
}
