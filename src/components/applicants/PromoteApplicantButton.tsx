import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAgentProfileDrawer } from "@/stores/agentProfileDrawer";
import { toast } from "sonner";

/**
 * PromoteApplicantButton — one-tap convert applications row to agents row.
 *
 * Sam directive 2026-06-17 (verbatim): "I didn't type in anybody in CRM.
 * I took the applicant and pushed them through whatever process I need to,
 * etcetera, in the full range of optimization."
 *
 * Calls the promote_applicant_to_agent(uuid, uuid) RPC shipped in migration
 * 20260618040000. The RPC:
 *  - Creates profiles row from name/email/phone
 *  - Creates agents row · status=active · default manager=SJAMES01
 *  - Flips applications.status to 'hired'
 *  - Auto-fires existing INSERT trigger → queues course + Discord emails
 *    (only if license_status='licensed' — Sam's rule)
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
}

export function PromoteApplicantButton({
  applicationId,
  applicantName,
  managerId,
  compact,
  onPromoted,
}: Props) {
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const openAgent = useAgentProfileDrawer((s) => s.openAgent);

  const handle = async () => {
    setBusy(true);
    try {
      const { data, error } = await (supabase as any).rpc("promote_applicant_to_agent", {
        p_application_id: applicationId,
        p_manager_id: managerId ?? null,
      });
      if (error) throw error;
      const newAgentId = (data as string | null) || null;
      if (!newAgentId) {
        toast.error("Promote returned no agent_id");
        return;
      }
      toast.success(`${applicantName ?? "Applicant"} promoted to Agent`);
      onPromoted?.(newAgentId);
      // Invalidate caches that show applicants/agents.
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["applications"] }),
        qc.invalidateQueries({ queryKey: ["dashboard-applicants"] }),
        qc.invalidateQueries({ queryKey: ["agents"] }),
        qc.invalidateQueries({ queryKey: ["interviews-unified"] }),
      ]);
      // Open the new agent's drawer so Sam can immediately tap Send Course Link.
      openAgent(newAgentId);
    } catch (e: any) {
      toast.error(`Promote failed: ${e?.message?.slice(0, 120) ?? "unknown"}`);
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
        title="Promote applicant to Agent"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}
      </Button>
    );
  }

  return (
    <Button
      variant="outline"
      size="sm"
      className="h-8 gap-1.5"
      disabled={busy}
      onClick={handle}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}
      <span className="text-xs">Promote</span>
    </Button>
  );
}

export default PromoteApplicantButton;
