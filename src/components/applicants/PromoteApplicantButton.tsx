import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAgentProfileDrawer } from "@/stores/agentProfileDrawer";
import { toast } from "sonner";
import { promoteApplicationToAgent } from "@/lib/hireToOnboarding";

/**
 * PromoteApplicantButton — one-tap convert applications row to agents row.
 *
 * Sam directive 2026-06-17 (verbatim): "I didn't type in anybody in CRM.
 * I took the applicant and pushed them through whatever process I need to,
 * etcetera, in the full range of optimization."
 *
 * Calls the account-owning add-agent edge function with the source application.
 * One tap creates/repairs auth + profile + agent, preserves hierarchy, records
 * the hire receipt, and queues the canonical contracting workflow when licensed.
 *
 * Idempotent — taps after the first one just open the existing agent.
 */

interface Props {
  applicationId: string;
  applicantName?: string;
  /** Optional manager override; defaults to SJAMES01 on the server. */
  managerId?: string;
  /** Compact icon-only mode for tight row UIs. */
  compact?: boolean;
  /** Called with the new agent_id after success. */
  onPromoted?: (agentId: string) => void;
  /** Context-specific copy; the default remains unchanged on applicant rows. */
  label?: string;
}

export function PromoteApplicantButton({
  applicationId,
  applicantName,
  managerId,
  compact,
  onPromoted,
  label = "Promote",
}: Props) {
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const openAgent = useAgentProfileDrawer((s) => s.openAgent);

  const handle = async () => {
    setBusy(true);
    try {
      const receipt = await promoteApplicationToAgent(applicationId, { managerId });
      const newAgentId = receipt.agentId;
      if (receipt.partial) toast.warning(receipt.message || `${applicantName ?? "Applicant"} hired; one follow-up needs attention`);
      else toast.success(receipt.message || `${applicantName ?? "Applicant"} hired and account created`);
      onPromoted?.(newAgentId);
      // Invalidate caches that show applicants/agents.
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["applications"] }),
        qc.invalidateQueries({ queryKey: ["dashboard-applicants"] }),
        qc.invalidateQueries({ queryKey: ["agents"] }),
        qc.invalidateQueries({ queryKey: ["interviews-unified"] }),
        qc.invalidateQueries({ queryKey: ["interviews-pipeline"] }),
      ]);
      // Open the complete account immediately for comp, Discord, training, and
      // contracting readiness follow-through.
      openAgent(newAgentId);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "unknown";
      toast.error(`Promote failed: ${message.slice(0, 120)}`);
    } finally {
      setBusy(false);
    }
  };

  if (compact) {
    return (
      <Button
        variant="outline"
        size="icon"
        className="h-7 w-7"
        disabled={busy}
        onClick={handle}
        title="Hire and create account"
        aria-label={`Hire ${applicantName ?? "applicant"} and create account`}
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}
      </Button>
    );
  }

  return (
    <Button
      variant="outline"
      size="sm"
      className="h-11 gap-1.5 sm:h-9"
      disabled={busy}
      onClick={handle}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}
      <span className="text-xs">{label === "Promote" ? "Hire & create account" : label}</span>
    </Button>
  );
}

export default PromoteApplicantButton;
