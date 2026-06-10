import { useMyNextStep } from "./useNextStepData";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { motion } from "framer-motion";
import { ArrowRight, Compass, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  applicationId?: string | null;
  agentId?: string | null;
  /** Compact mode used in tight UI surfaces. */
  compact?: boolean;
}

/**
 * NextStepCandidateCard — the signed-in candidate's "what's next" tile.
 *
 * Reads v_next_step_candidate filtered to the caller's applicationId or
 * agentId. Renders the current stage's display name, the next-action label
 * (clickable when next_action_url is set), days-in-stage, and an SLA
 * countdown when the stage is stalled.
 *
 * Designed to drop into AgentPortal / Today / DashboardCRM. Renders null
 * when no candidate row matches (e.g. for non-recruit users).
 */
export function NextStepCandidateCard({ applicationId, agentId, compact = false }: Props) {
  const { data, isLoading } = useMyNextStep(applicationId, agentId);

  if (isLoading) return <Skeleton className={compact ? "h-20 rounded-lg" : "h-32 rounded-md"} />;
  if (!data) return null;

  const stalled = data.is_stalled;
  const daysLabel = data.days_in_stage >= 30 ? `${Math.round(data.days_in_stage)}d` : `${data.days_in_stage.toFixed(1)}d`;
  const tone = stalled ? "rose" : data.days_in_stage > 7 ? "amber" : "emerald";
  const toneClasses: Record<typeof tone, { border: string; bg: string; accent: string }> = {
    rose:    { border: "border-rose-500/40",    bg: "from-rose-500/10",    accent: "text-rose-300"    },
    amber:   { border: "border-amber-500/30",   bg: "from-amber-500/10",   accent: "text-amber-300"   },
    emerald: { border: "border-emerald-500/30", bg: "from-emerald-500/10", accent: "text-emerald-300" },
  } as const;
  const t = toneClasses[tone];

  if (compact) {
    return (
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <Card className={cn("p-3 border  via-card to-card", t.border, t.bg)}>
          <div className="flex items-center gap-3">
            <Compass className={cn("h-4 w-4 shrink-0", t.accent)} />
            <div className="min-w-0 flex-1">
              <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground leading-none">Next step</p>
              <p className="text-sm font-semibold truncate mt-0.5">{data.stage_display_name}</p>
              <p className="text-[11px] text-muted-foreground truncate">{data.next_action_label}</p>
            </div>
            {data.next_action_url && (
              <a href={data.next_action_url} className={cn("rounded-md border px-2 py-1.5 text-[11px] font-medium inline-flex items-center gap-1", t.border, t.accent)}>
                Go <ArrowRight className="h-3 w-3" />
              </a>
            )}
          </div>
        </Card>
      </motion.div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
      <Card className={cn("p-5 sm:p-6 border  via-card to-card", t.border, t.bg)}>
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex items-start gap-3 min-w-0">
            <div className={cn("rounded-md p-3 border shrink-0", t.border, "bg-card/60")}>
              <Compass className={cn("h-6 w-6", t.accent)} />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Your next step</p>
              <h2 className="text-xl sm:text-2xl font-bold tracking-tight mt-0.5">{data.stage_display_name}</h2>
              {data.next_action_label && (
                <p className="text-sm text-muted-foreground leading-snug mt-1">{data.next_action_label}</p>
              )}
            </div>
          </div>

          <div className="text-right shrink-0">
            <div className={cn("text-2xl font-bold tabular-nums leading-none", t.accent)}>
              <Clock className="h-4 w-4 inline-block mr-0.5 -mt-0.5" />
              {daysLabel}
            </div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">in stage</p>
            {stalled && data.sla_hours && (
              <p className="text-[10px] text-rose-300 mt-1">past SLA · {data.sla_hours}h</p>
            )}
          </div>
        </div>

        {data.candidate_message_template && (
          <p className="text-sm text-foreground/90 leading-relaxed mb-4 italic">
            "{data.candidate_message_template}"
          </p>
        )}

        {data.next_action_url && (
          <div className="flex flex-wrap gap-2">
            <a
              href={data.next_action_url}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md border bg-card hover:bg-muted px-3 py-2 transition-colors text-sm font-medium",
                t.border,
                t.accent,
              )}
            >
              Take the next step
              <ArrowRight className="h-4 w-4" />
            </a>
          </div>
        )}

        {data.failure_label && stalled && (
          <p className="text-[11px] text-rose-300/90 mt-3 italic">
            Stall consequence: {data.failure_label}
          </p>
        )}
      </Card>
    </motion.div>
  );
}
