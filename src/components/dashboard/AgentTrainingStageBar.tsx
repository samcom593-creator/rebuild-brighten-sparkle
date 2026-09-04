/**
 * AgentTrainingStageBar — 4-step release tracker.
 *
 * 2026-06-15 — Sam directive (voice): "It should have systems where it's easy
 * to see, check whether they're in field training, on court [classroom], in
 * classroom. Inventory borrowers active in the field — i.e. active producing
 * in the field."
 *
 * Source: v_agent_training_stage (manual override wins; otherwise derived
 * from license_status + first_deal_at + field_training_started_at +
 * onboarding_stage). Date stamps come from the same view so we never invent
 * dates.
 *
 * Admin manual override: dropdown writes agents.training_stage_override +
 * training_stage_override_at + training_stage_override_by. Non-admins see
 * read-only.
 */

import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, GraduationCap, BookOpenCheck, Compass, Briefcase, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Stage = "test" | "classroom" | "field" | "active" | "unknown";

const ORDERED: Stage[] = ["test", "classroom", "field", "active"];

const META: Record<Stage, { label: string; icon: any; color: string; ring: string; dot: string }> = {
  test:      { label: "Onboarding",        icon: GraduationCap, color: "text-amber-600 dark:text-amber-400", ring: "ring-amber-500/30", dot: "bg-amber-500" },
  classroom: { label: "Training Complete", icon: BookOpenCheck, color: "text-info dark:text-info", ring: "ring-sky-500/30", dot: "bg-info" },
  field:     { label: "Field",      icon: Compass,      color: "text-violet-600 dark:text-violet-400", ring: "ring-violet-500/30",  dot: "bg-violet-500" },
  active:    { label: "Active",     icon: Briefcase,    color: "text-emerald-600 dark:text-emerald-400", ring: "ring-emerald-500/30", dot: "bg-emerald-500" },
  unknown:   { label: "Pending",    icon: RefreshCw,    color: "text-muted-foreground",                ring: "ring-border",         dot: "bg-muted" },
};

interface ViewRow {
  agent_id: string;
  stage: Stage;
  test_started_at: string | null;
  classroom_started_at: string | null;
  field_started_at: string | null;
  active_started_at: string | null;
  training_stage_override: Stage | null;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });
  } catch {
    return "—";
  }
}

interface Props {
  agentId: string;
  compact?: boolean;
}

export function AgentTrainingStageBar({ agentId, compact = false }: Props) {
  const { isAdmin, isManager } = useAuth();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<ViewRow | null>({
    queryKey: ["agent-training-stage", agentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_agent_training_stage" as any)
        .select(
          "agent_id, stage, test_started_at, classroom_started_at, field_started_at, active_started_at, training_stage_override",
        )
        .eq("agent_id", agentId)
        .maybeSingle();
      if (error) throw error;
      return (data as any) ?? null;
    },
    staleTime: 60_000,
  });

  const setOverride = useMutation({
    mutationFn: async (next: Stage | "auto") => {
      const { error } = await (supabase as any).rpc("set_agent_training_stage", {
        p_agent_id: agentId,
        p_stage: next === "auto" ? null : next,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agent-training-stage", agentId] });
      qc.invalidateQueries({ queryKey: ["agency-training-stage-counts"] });
      toast.success("Training stage updated");
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to update stage"),
  });

  const stage: Stage = (data?.stage as Stage) ?? "unknown";
  const currentIdx = ORDERED.indexOf(stage);
  const stamps = useMemo(
    () => ({
      test: data?.test_started_at ?? null,
      classroom: data?.classroom_started_at ?? null,
      field: data?.field_started_at ?? null,
      active: data?.active_started_at ?? null,
    }),
    [data?.test_started_at, data?.classroom_started_at, data?.field_started_at, data?.active_started_at],
  );

  if (isLoading) {
    return (
      <div className="h-12 rounded-lg border border-border bg-card/60 animate-pulse" aria-label="Loading training stage" />
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card/60 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Training stage</span>
          {stage === "unknown" ? (
            <Badge variant="outline" className="text-[10px] bg-muted/50">Stage pending</Badge>
          ) : (
            <Badge variant="outline" className={cn("text-[10px] font-bold", META[stage].color)}>
              {META[stage].label}
            </Badge>
          )}
          {data?.training_stage_override && (
            <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-600 border-amber-500/20">manual</Badge>
          )}
        </div>
        {(isAdmin || isManager) && (
          <Select
            value={data?.training_stage_override ?? "auto"}
            onValueChange={(v) => setOverride.mutate(v as Stage | "auto")}
            disabled={setOverride.isPending}
          >
            <SelectTrigger className="h-7 w-[140px] text-xs">
              <SelectValue placeholder="Set stage" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Auto (derived)</SelectItem>
              <SelectItem value="test">Onboarding</SelectItem>
              <SelectItem value="classroom">Training Complete</SelectItem>
              <SelectItem value="field">Field</SelectItem>
              <SelectItem value="active">Active</SelectItem>
            </SelectContent>
          </Select>
        )}
      </div>

      {/* 4-dot bar */}
      <div className="flex items-center gap-0">
        {ORDERED.map((s, idx) => {
          const reached = currentIdx >= 0 && idx <= currentIdx;
          const isCurrent = idx === currentIdx;
          const M = META[s];
          const Icon = M.icon;
          return (
            <div key={s} className="flex items-center flex-1 min-w-0">
              <div
                className={cn(
                  "relative h-7 w-7 rounded-full border-2 grid place-items-center transition-colors shrink-0",
                  reached ? cn(M.dot, "border-transparent text-foreground") : "bg-background border-border text-muted-foreground",
                  isCurrent && "ring-2 ring-offset-1 ring-offset-background",
                  isCurrent && M.ring,
                )}
                title={`${M.label}${stamps[s] ? ` — ${fmtDate(stamps[s])}` : ""}`}
                aria-label={M.label}
              >
                {reached && !isCurrent ? <Check className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" />}
              </div>
              {idx < ORDERED.length - 1 && (
                <div
                  className={cn(
                    "flex-1 h-0.5 transition-colors min-w-[8px]",
                    currentIdx > idx ? META[ORDERED[idx + 1]].dot : "bg-border",
                  )}
                />
              )}
            </div>
          );
        })}
      </div>

      {!compact && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 pt-1">
          {ORDERED.map((s) => (
            <div key={s} className="flex flex-col">
              <span className={cn("text-[10px] font-semibold uppercase tracking-wide", META[s].color)}>{META[s].label}</span>
              <span className="text-[11px] tabular-nums text-foreground/80">{fmtDate(stamps[s])}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
