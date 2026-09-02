// AccountRoleControl · admin-only role switcher on any producer profile.
//
// Before this, the only way to make someone a manager was buried in the
// AgentQuickEditDialog off the CRM table; the profile page a leader actually
// opens (screenshot: John Riley, /dashboard/profile?agentId=…) had no control
// at all. Same RPC as the dialog — set_account_mode — so the two surfaces can
// never disagree about what "manager" means (agents.account_mode +
// agents.is_manager + user_roles, all written in one SECURITY DEFINER call).
//
// Reads the current mode straight off `agents` by primary key (id is unique,
// so .maybeSingle() cannot lose an answer to ambiguity). Non-admins see the
// badge only; the RPC refuses them server-side regardless.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Shield } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const ACCOUNT_MODE_LABELS: Record<string, string> = {
  agent: "Agent",
  manager: "Manager",
  agency_owner: "Agency Owner",
  recruiter: "Pure Recruiter",
  va: "VA",
  va_manager: "VA Manager",
};

const MODE_ORDER = ["agent", "manager", "agency_owner", "recruiter", "va", "va_manager"] as const;

interface AgentModeRow { account_mode: string | null; is_manager: boolean | null }

export function AccountRoleControl({ agentId, agentName }: { agentId: string; agentName: string }) {
  const { isAdmin } = useAuth();
  const qc = useQueryClient();

  const mode = useQuery({
    queryKey: ["agent-account-mode", agentId],
    queryFn: async (): Promise<AgentModeRow | null> => {
      const { data, error } = await supabase
        .from("agents")
        .select("account_mode, is_manager")
        .eq("id", agentId)
        .maybeSingle();
      if (error) throw error;
      return (data as AgentModeRow | null) ?? null;
    },
  });

  const current = mode.data?.account_mode ?? (mode.data?.is_manager ? "manager" : null);
  const isManagerLike = current === "manager" || current === "agency_owner" || !!mode.data?.is_manager;

  const change = async (next: string) => {
    if (!next || next === current) return;
    const { data, error } = await supabase.rpc("set_account_mode" as never, { p_agent_id: agentId, p_mode: next } as never);
    const res = data as { ok?: boolean; error?: string } | null;
    if (error || !res?.ok) {
      toast.error("Role change failed", { description: res?.error || error?.message || "set_account_mode did not confirm the write." });
      return;
    }
    toast.success(`${agentName} is now ${ACCOUNT_MODE_LABELS[next] ?? next}`, {
      description: next === "manager" || next === "agency_owner"
        ? "Manager permissions granted. Recruiting links, team scope and manager nav unlock on their next page load."
        : "Role updated.",
    });
    await qc.invalidateQueries({ queryKey: ["agent-account-mode", agentId] });
    await qc.invalidateQueries({ queryKey: ["producer-profile-detail", agentId] });
  };

  if (mode.isLoading) return null;

  if (!isAdmin) {
    return isManagerLike ? (
      <Badge variant="outline" className="border-primary/40 bg-primary/10 text-[10px] font-bold uppercase tracking-wide text-primary">
        <Shield className="mr-1 h-3 w-3" /> {ACCOUNT_MODE_LABELS[current ?? "manager"] ?? "Manager"}
      </Badge>
    ) : null;
  }

  return (
    <div className="flex items-center gap-2">
      {isManagerLike && (
        <Badge variant="outline" className="border-primary/40 bg-primary/10 text-[10px] font-bold uppercase tracking-wide text-primary">
          <Shield className="mr-1 h-3 w-3" /> {ACCOUNT_MODE_LABELS[current ?? "manager"] ?? "Manager"}
        </Badge>
      )}
      <Select value={current ?? "agent"} onValueChange={change}>
        <SelectTrigger aria-label="Account role" className={cn("h-8 w-[160px] text-xs")}>
          <SelectValue placeholder="Role" />
        </SelectTrigger>
        <SelectContent>
          {MODE_ORDER.map((m) => (
            <SelectItem key={m} value={m} className="text-xs">{ACCOUNT_MODE_LABELS[m]}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
