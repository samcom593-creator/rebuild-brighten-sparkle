import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CheckCircle2, ArrowRight, Clock, Compass } from "lucide-react";
import { useNextStep, NextStepRow } from "@/hooks/useNextStep";
import { cn } from "@/lib/utils";

interface Props {
  application_id?: string | null;
  agent_id?: string | null;
  compact?: boolean;
}

function formatDistance(target: Date, now = new Date()): string {
  const ms = Math.abs(target.getTime() - now.getTime());
  const h = Math.round(ms / 3_600_000);
  if (h < 1) return "minutes";
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d`;
  return `${Math.round(d / 7)}w`;
}

export function NextStepCard({ application_id, agent_id, compact = false }: Props) {
  const { data: row, isLoading } = useNextStep({ application_id, agent_id });

  if (isLoading) {
    return (
      <Card className="p-5 border border-border/40 bg-card animate-pulse">
        <div className="h-6 w-48 bg-muted/30 rounded mb-3" />
        <div className="h-3 w-full bg-muted/20 rounded" />
      </Card>
    );
  }

  if (!row) return null;

  const sla = row.sla_due_at ? new Date(row.sla_due_at) : null;
  const isUrgent = row.is_stalled;
  const slaLabel = sla
    ? sla > new Date()
      ? `Deadline in ${formatDistance(sla)}`
      : `Overdue by ${formatDistance(sla)}`
    : "No deadline";

  const borderClass = isUrgent
    ? "border-rose-500/40 bg-gradient-to-br from-rose-500/10 via-card to-card"
    : "border-blue-500/40 bg-gradient-to-br from-blue-500/8 via-card to-card";

  const accent = isUrgent ? "text-rose-300" : "text-blue-300";

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
      <Card className={cn("p-5 sm:p-6 transition-colors", borderClass)}>
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex items-start gap-3 min-w-0">
            <div className={cn("rounded-xl p-3 border shrink-0", isUrgent ? "bg-rose-500/15 border-rose-500/30" : "bg-blue-500/15 border-blue-500/30")}>
              <Compass className={cn("h-6 w-6", accent)} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant={isUrgent ? "destructive" : "secondary"} className="text-[10px] uppercase tracking-wider">
                  Stage {row.order_index} / {row.total_stages}
                </Badge>
                {isUrgent && <AlertTriangle className="h-3.5 w-3.5 text-rose-400" />}
                <span className="text-[11px] text-muted-foreground uppercase tracking-wider">{row.stage_display_name}</span>
              </div>
              <h2 className="text-xl sm:text-2xl font-bold tracking-tight mt-1">{row.next_action_label}</h2>
              <p className="text-[12px] text-muted-foreground mt-1 flex items-center gap-1.5">
                <Clock className="h-3 w-3" />{slaLabel} · in stage {Math.round(row.days_in_stage)}d
              </p>
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className={cn("text-3xl font-bold tabular-nums leading-none", accent)}>{row.percent_complete}%</div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider mt-1">progress</div>
          </div>
        </div>

        <Progress value={row.percent_complete} className="h-2 mb-4" />

        {row.next_action_url && (
          <Link
            to={row.next_action_url.startsWith("http") ? row.next_action_url : row.next_action_url}
            className={cn(
              "inline-flex items-center justify-center w-full gap-2 rounded-md px-4 py-2.5 text-sm font-semibold transition-colors",
              isUrgent ? "bg-rose-500/20 border border-rose-500/40 text-rose-100 hover:bg-rose-500/30" : "bg-blue-500/20 border border-blue-500/40 text-blue-100 hover:bg-blue-500/30",
            )}
          >
            {row.next_action_label} <ArrowRight className="h-4 w-4" />
          </Link>
        )}

        {!compact && (row.completed_stages || row.upcoming_stages) && (
          <details className="mt-4 pt-4 border-t border-border/40 group">
            <summary className="cursor-pointer text-[11px] text-muted-foreground uppercase tracking-[0.18em] hover:text-foreground transition-colors">
              See the full path · {row.completed_stages?.length ?? 0} done · {(row.upcoming_stages?.length ?? 1) - 1} ahead
            </summary>
            <ol className="mt-3 space-y-1.5 text-sm">
              {row.completed_stages?.map((s) => (
                <li key={s.key} className="flex items-center gap-2 text-emerald-300/80">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  <span>{s.order}. {s.name}</span>
                </li>
              ))}
              <li className={cn("flex items-center gap-2 font-semibold", accent)}>
                <ArrowRight className="h-3.5 w-3.5" />
                <span>{row.order_index}. {row.stage_display_name} (you are here)</span>
              </li>
              {row.upcoming_stages?.slice(1).map((s) => (
                <li key={s.key} className="flex items-center gap-2 text-muted-foreground">
                  <Clock className="h-3.5 w-3.5" />
                  <span>{s.order}. {s.name}</span>
                </li>
              ))}
            </ol>
          </details>
        )}
      </Card>
    </motion.div>
  );
}

export default NextStepCard;
