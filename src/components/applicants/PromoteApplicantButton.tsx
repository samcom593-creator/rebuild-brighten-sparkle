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
      const [{ data: auth }, { data: app, error: appError }] = await Promise.all([
        supabase.auth.getUser(),
        supabase.from("applications").select(
          "id,first_name,last_name,email,phone,city,state,instagram_handle,license_status,nipr_number,assigned_agent_id",
        ).eq("id", applicationId).maybeSingle(),
      ]);
      if (appError || !app) throw new Error(appError?.message || "Application was not found");
      if (!auth.user) throw new Error("Your session expired. Sign in and try again.");

      const { data: actorAgent, error: actorError } = await supabase
        .from("agents")
        .select("id")
        .eq("user_id", auth.user.id)
        .eq("is_deactivated", false)
        .limit(1)
        .maybeSingle();
      if (actorError) throw actorError;
      const resolvedManagerId = managerId ?? actorAgent?.id ?? app.assigned_agent_id;
      if (!resolvedManagerId) throw new Error("Assign a hiring manager before creating the account");

      const { data, error } = await supabase.functions.invoke("add-agent", {
        body: {
          firstName: app.first_name,
          lastName: app.last_name,
          email: app.email,
          phone: app.phone || "",
          managerId: resolvedManagerId,
          licenseStatus: app.license_status,
          niprNumber: app.nipr_number || undefined,
          city: app.city || undefined,
          state: app.state || undefined,
          instagramHandle: app.instagram_handle || undefined,
          hasTrainingCourse: app.license_status === "licensed",
          sourceApplicationId: applicationId,
        },
      });
      if (error) {
        let message = error.message;
        const context = (error as { context?: Response }).context;
        if (context) {
          let payload: { error?: string } | null = null;
          try {
            payload = await context.clone().json() as { error?: string };
          } catch (parseError) {
            console.error("[PromoteApplicantButton] could not parse add-agent error response", parseError);
          }
          message = payload?.error || message;
        }
        throw new Error(message);
      }
      if (data?.error) throw new Error(String(data.error));
      const newAgentId = (data?.agentId as string | null) || null;
      if (!newAgentId) {
        toast.error("Promote returned no agent_id");
        return;
      }
      if (data?.partial) toast.warning(data.message || `${applicantName ?? "Applicant"} hired; one follow-up needs attention`);
      else toast.success(data?.message || `${applicantName ?? "Applicant"} hired and account created`);
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
