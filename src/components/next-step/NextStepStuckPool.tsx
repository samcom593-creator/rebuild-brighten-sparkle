import { useNextStepStuck } from "./useNextStepData";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, Clock, ArrowRight, ExternalLink, Phone, Mail } from "lucide-react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { contactLinkProps, phoneHref } from "@/lib/phone";

const SEVERITY_TONE: Record<string, { ring: string; chip: string; text: string }> = {
  critical: { ring: "border-rose-500/50",   chip: "bg-rose-500/20 text-rose-200 border-rose-500/40",     text: "text-rose-200" },
  high:     { ring: "border-orange-500/40", chip: "bg-orange-500/20 text-orange-200 border-orange-500/40", text: "text-orange-200" },
  medium:   { ring: "border-amber-500/30",  chip: "bg-amber-500/15 text-amber-200 border-amber-500/30",  text: "text-amber-200" },
  low:      { ring: "border-emerald-500/30",chip: "bg-emerald-500/10 text-emerald-200 border-emerald-500/30", text: "text-emerald-200" },
  unknown:  { ring: "border-border",        chip: "bg-muted text-muted-foreground border-border",        text: "text-muted-foreground" },
};

interface NextStepStuckPoolProps {
  /** Restrict to a manager's downline. Omit for the global admin pool. */
  ownerUserId?: string | null;
  /** Override the default top-N (8). */
  limit?: number;
  /** Custom heading override (defaults to "Longest-stuck candidates"). */
  heading?: string;
  /** Custom subheading override. */
  subheading?: string;
}

/**
 * NextStepStuckPool — admin/manager card surfacing the candidates rotting
 * the longest in their current stage. Reads v_next_step_stuck_pool.
 *
 * Renders on DashboardCommandCenter (admin) and Today (manager-scoped).
 * Each row shows: severity chip, name, stage, days-in-stage, next-action-
 * label, and a one-click contact button + jump-to-action link. The
 * pg_cron stall_sweep fires every 15min — data is always <=15min fresh.
 */
export function NextStepStuckPool({ ownerUserId, limit = 8, heading, subheading }: NextStepStuckPoolProps = {}) {
  const { data, isLoading, error } = useNextStepStuck(limit, ownerUserId);

  if (isLoading) {
    return <Skeleton className="h-64 rounded-md" />;
  }
  if (error || !data || data.length === 0) {
    return null;
  }

  const criticalCount = data.filter((r) => r.severity === "critical").length;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <Card className="p-5 sm:p-6 border border-amber-500/30 bg-white dark:bg-card">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex items-start gap-3 min-w-0">
            <div className="rounded-md bg-amber-500/15 p-3 border border-amber-500/30 shrink-0">
              <AlertTriangle className="h-6 w-6 text-amber-400" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-[0.18em] text-amber-400/80">
                {ownerUserId ? "Your downline · stuck" : "Stuck pipeline · auto-detected via SLA + stall thresholds"}
              </p>
              <h2 className="text-xl sm:text-2xl font-bold tracking-tight mt-0.5">
                {heading ?? "Longest-stuck candidates"}
              </h2>
              <p className="text-[12px] text-muted-foreground leading-snug mt-1 max-w-2xl">
                {subheading ?? "Each row is a real applicant or agent stalled past their stage SLA. Critical = blew past 2× the stall threshold. Cron sweep runs every 15 min — call them today, not tomorrow."}
              </p>
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-3xl font-bold text-rose-300 tabular-nums">{criticalCount}</div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">critical</p>
          </div>
        </div>

        <ul className="divide-y divide-border/60">
          {data.map((row) => {
            const sev = SEVERITY_TONE[row.severity ?? "unknown"] ?? SEVERITY_TONE.unknown;
            const fullName = [row.first_name, row.last_name].filter(Boolean).join(" ").trim() || "—";
            const daysLabel =
              row.days_in_stage >= 30
                ? `${Math.round(row.days_in_stage)}d`
                : `${row.days_in_stage.toFixed(1)}d`;
            return (
              <li key={row.application_id} className="py-3 flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <Badge variant="outline" className={cn("font-mono text-[10px] uppercase shrink-0", sev.chip)}>
                    {row.severity ?? "—"}
                  </Badge>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold leading-tight truncate">{fullName}</p>
                    <p className="text-[11px] text-muted-foreground leading-tight truncate">
                      {row.stage_display_name} · {row.next_action_label ?? "next step pending"}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <div className="text-right">
                    <div className={cn("text-lg font-bold tabular-nums leading-none", sev.text)}>
                      <Clock className="h-3 w-3 inline-block mr-0.5 -mt-0.5" />
                      {daysLabel}
                    </div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">in stage</p>
                  </div>

                  <div className="flex items-center gap-1">
                    {row.phone && (
                      <a
                        href={phoneHref(row.phone) ?? `tel:${row.phone}`} {...contactLinkProps(phoneHref(row.phone))}
                        className="rounded-md border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 p-1.5 transition-colors"
                        title={`Call ${fullName}`}
                      >
                        <Phone className="h-3.5 w-3.5" />
                      </a>
                    )}
                    {row.email && (
                      <a
                        href={`mailto:${row.email}`}
                        className="rounded-md border border-border bg-card hover:bg-muted p-1.5 transition-colors"
                        title={`Email ${fullName}`}
                      >
                        <Mail className="h-3.5 w-3.5" />
                      </a>
                    )}
                    {row.next_action_url && (
                      <a
                        href={row.next_action_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-md border border-primary/30 bg-primary/10 hover:bg-primary/20 text-primary p-1.5 transition-colors"
                        title="Open next-step action"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    )}
                    <Link
                      to={`/dashboard/applicants?id=${row.application_id}`}
                      className="rounded-md border border-border bg-card hover:bg-muted p-1.5 transition-colors"
                      title="Open applicant"
                    >
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </Card>
    </motion.div>
  );
}
