import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BadgeCheck,
  BookOpenCheck,
  Check,
  Circle,
  FileSignature,
  Loader2,
  MessageCircle,
  ShieldCheck,
  TriangleAlert,
  UserRoundCheck,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { looseSupabase } from "@/lib/looseSupabase";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type WorkflowStatus =
  | "not_started"
  | "ready_to_send"
  | "sent"
  | "agent_action_required"
  | "submitted"
  | "active"
  | "issue"
  | "declined"
  | "not_needed";

interface ContractChecklistRow {
  carrier_id: string;
  carrier_name: string;
  workflow_status: WorkflowStatus;
  sent_at: string | null;
  sent_by_name: string | null;
  completed_at: string | null;
  status_note: string | null;
  contract_pct: number | string | null;
  effective_pct: number | string | null;
  override_pct: number | string | null;
  live_status: string | null;
  writing_number: string | null;
  contract_number: string | null;
  updated_at: string | null;
}

interface OnboardingSnapshot {
  user_id: string | null;
  license_status: string | null;
  contracted_at: string | null;
  has_training_course: boolean | null;
  has_discord_access: boolean | null;
  field_training_started_at: string | null;
  onboarding_completed_at: string | null;
  first_deal_at: string | null;
}

const STATUS_OPTIONS: Array<{ value: WorkflowStatus; label: string }> = [
  { value: "not_started", label: "Not started" },
  { value: "ready_to_send", label: "Ready to send" },
  { value: "sent", label: "Contracts sent" },
  { value: "agent_action_required", label: "Agent action needed" },
  { value: "submitted", label: "Submitted" },
  { value: "active", label: "Active" },
  { value: "issue", label: "Needs attention" },
  { value: "declined", label: "Declined" },
  { value: "not_needed", label: "Not needed" },
];

const SENT_STATUSES = new Set<WorkflowStatus>([
  "sent", "agent_action_required", "submitted", "active", "issue", "declined",
]);
const ATTENTION_STATUSES = new Set<WorkflowStatus>(["agent_action_required", "issue", "declined"]);

function formatDateTime(value: string | null): string {
  if (!value) return "";
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function statusTone(status: WorkflowStatus): string {
  if (status === "active") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-500";
  if (status === "sent" || status === "submitted") return "border-primary/30 bg-primary/10 text-primary";
  if (ATTENTION_STATUSES.has(status)) return "border-amber-500/30 bg-amber-500/10 text-amber-500";
  return "border-border bg-muted/40 text-muted-foreground";
}

export function AgentOnboardingCommandCenter({
  agentId,
  agentName,
}: {
  agentId: string;
  agentName: string;
}) {
  const { isAdmin } = useAuth();
  const qc = useQueryClient();

  const snapshotQ = useQuery<OnboardingSnapshot | null>({
    queryKey: ["agent-onboarding-command-snapshot", agentId],
    enabled: !!agentId,
    staleTime: 30_000,
    queryFn: async () => {
      // Generated database types lag the live agents schema (first_deal_at and
      // onboarding_completed_at are already deployed), so use the project's
      // typed loose adapter for this narrow query.
      const { data, error } = await looseSupabase
        .from<OnboardingSnapshot>("agents")
        .select("user_id,license_status,contracted_at,has_training_course,has_discord_access,field_training_started_at,onboarding_completed_at,first_deal_at")
        .eq("id", agentId)
        .maybeSingle();
      if (error) throw error;
      return (data as OnboardingSnapshot | null) ?? null;
    },
  });

  const contractsQ = useQuery<ContractChecklistRow[]>({
    queryKey: ["agent-contract-checklist", agentId],
    enabled: !!agentId,
    staleTime: 20_000,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as (fn: string, args: Record<string, unknown>) => ReturnType<typeof supabase.rpc>)(
        "apex_agent_contract_checklist",
        { p_agent_id: agentId },
      );
      if (error) throw error;
      return ((data ?? []) as unknown as ContractChecklistRow[]);
    },
  });

  const statusMutation = useMutation({
    mutationFn: async ({ carrierId, status }: { carrierId: string; status: WorkflowStatus }) => {
      const { error } = await (supabase.rpc as (fn: string, args: Record<string, unknown>) => ReturnType<typeof supabase.rpc>)(
        "apex_set_agent_contract_status",
        { p_agent_id: agentId, p_carrier_id: carrierId, p_status: status, p_note: null },
      );
      if (error) throw error;
      return status;
    },
    onSuccess: (status) => {
      qc.invalidateQueries({ queryKey: ["agent-contract-checklist", agentId] });
      qc.invalidateQueries({ queryKey: ["agent-onboarding-command-snapshot", agentId] });
      toast.success(status === "sent" ? "Contract packet marked sent" : "Contract status updated");
    },
    onError: (error: Error) => toast.error(`Contract update failed: ${error.message.slice(0, 100)}`),
  });

  const contracts = contractsQ.data ?? [];
  const sentCount = contracts.filter((row) => row.sent_at || SENT_STATUSES.has(row.workflow_status)).length;
  const activeCount = contracts.filter((row) => row.workflow_status === "active" || row.live_status?.toLowerCase() === "active").length;
  const attentionCount = contracts.filter((row) => ATTENTION_STATUSES.has(row.workflow_status)).length;
  const applicableCount = contracts.filter((row) => row.workflow_status !== "not_needed").length;
  const completedCount = contracts.filter((row) => row.workflow_status === "active" || row.workflow_status === "not_needed").length;
  const contractPct = contracts.length ? Math.round((completedCount / contracts.length) * 100) : 0;

  const steps = useMemo(() => {
    const row = snapshotQ.data;
    return [
      { label: "Account", done: !!row?.user_id, icon: UserRoundCheck },
      { label: "Licensed", done: row?.license_status === "licensed", icon: ShieldCheck },
      { label: "Contracts sent", done: sentCount > 0 || !!row?.contracted_at, icon: FileSignature },
      { label: "Carrier active", done: activeCount > 0, icon: BadgeCheck },
      { label: "Training access", done: !!row?.has_training_course, icon: BookOpenCheck },
      { label: "Discord access", done: !!row?.has_discord_access, icon: MessageCircle },
      { label: "Field training", done: !!row?.field_training_started_at, icon: Check },
      { label: "First deal", done: !!row?.first_deal_at, icon: Check },
    ];
  }, [activeCount, sentCount, snapshotQ.data]);
  const finishedSteps = steps.filter((step) => step.done).length;
  const onboardingPct = Math.round((finishedSteps / steps.length) * 100);

  return (
    <section className="overflow-hidden rounded-3xl border border-border bg-card/50" data-testid="agent-onboarding-command-center">
      <div className="space-y-3 border-b border-border p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-amber-500">Onboarding command center</p>
            <h3 className="mt-1 text-sm font-bold">{agentName}</h3>
          </div>
          <Badge variant="outline" className="tabular-nums">{finishedSteps}/{steps.length} complete</Badge>
        </div>
        <Progress value={onboardingPct} className="h-2" />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {steps.map((step) => {
            const Icon = step.icon;
            return (
              <div key={step.label} className={cn(
                "flex min-w-0 items-center gap-1.5 rounded-lg border px-2 py-2 text-[10px] font-semibold",
                step.done
                  ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-500"
                  : "border-border bg-background/60 text-muted-foreground",
              )}>
                {step.done ? <Icon className="h-3 w-3 shrink-0" /> : <Circle className="h-3 w-3 shrink-0" />}
                <span className="truncate">{step.label}</span>
              </div>
            );
          })}
        </div>
      </div>

      <details open className="group">
        <summary className="cursor-pointer list-none px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <FileSignature className="h-4 w-4 text-amber-500" />
              <span className="text-xs font-bold uppercase tracking-wide">Carrier contracts</span>
            </div>
            <div className="flex flex-wrap gap-1.5 text-[10px]">
              <Badge variant="outline">{sentCount}/{applicableCount || contracts.length} sent</Badge>
              <Badge variant="outline" className="border-emerald-500/30 text-emerald-500">{activeCount} active</Badge>
              {attentionCount > 0 && (
                <Badge variant="outline" className="border-amber-500/30 text-amber-500">
                  <TriangleAlert className="mr-1 h-3 w-3" /> {attentionCount} needs attention
                </Badge>
              )}
            </div>
          </div>
          <Progress value={contractPct} className="mt-2 h-1.5" />
        </summary>

        <div className="border-t border-border">
          {contractsQ.isLoading ? (
            <div className="flex items-center justify-center gap-2 p-5 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading contracts
            </div>
          ) : contractsQ.isError ? (
            <p className="p-4 text-xs text-rose-500">Contract checklist could not be loaded.</p>
          ) : contracts.length === 0 ? (
            <p className="p-4 text-xs text-muted-foreground">No active carriers are configured.</p>
          ) : (
            <ul className="divide-y divide-border/70">
              {contracts.map((row) => {
                const comp = row.effective_pct ?? row.contract_pct;
                const isSaving = statusMutation.isPending && statusMutation.variables?.carrierId === row.carrier_id;
                return (
                  <li key={row.carrier_id} className="space-y-2 px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{row.carrier_name}</p>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-muted-foreground">
                          <span>Comp {comp == null ? "—" : `${Number(comp)}%`}</span>
                          {row.live_status && <span>AgentLink: {row.live_status.replace(/_/g, " ")}</span>}
                          {row.writing_number && <span>Writing #{row.writing_number}</span>}
                        </div>
                        {row.sent_at && (
                          <p className="mt-1 text-[10px] text-muted-foreground">
                            Sent {formatDateTime(row.sent_at)}{row.sent_by_name ? ` by ${row.sent_by_name}` : ""}
                          </p>
                        )}
                      </div>
                      <Badge variant="outline" className={cn("shrink-0 text-[9px]", statusTone(row.workflow_status))}>
                        {STATUS_OPTIONS.find((option) => option.value === row.workflow_status)?.label ?? row.workflow_status}
                      </Badge>
                    </div>
                    {isAdmin ? (
                      <Select
                        value={row.workflow_status}
                        disabled={isSaving}
                        onValueChange={(value: WorkflowStatus) => statusMutation.mutate({ carrierId: row.carrier_id, status: value })}
                      >
                        <SelectTrigger className="h-8 text-xs" aria-label={`Contract status for ${row.carrier_name}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {STATUS_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </details>
    </section>
  );
}
