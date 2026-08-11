import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SkeletonLoader } from "@/components/ui/skeleton-loader";
import { PageHeader } from "@/components/ui/page-header";
import {
  Shield,
  RefreshCw,
  CheckCircle,
  AlertTriangle,
  XCircle,
  Clock,
  Zap,
  Database,
  Mail,
  MessageSquare,
  Users,
  BarChart3,
  HardDrive,
  Lock,
  Radio,
  CreditCard,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { FunctionErrorsPanel, AuditLogPanel, ClientErrorsPanel } from "@/components/system-health/ObservabilityPanels";

interface HealthResult {
  service: string;
  status: "healthy" | "degraded" | "down";
  responseTime: number;
  message: string;
  autoFixed?: boolean;
  requiresAction?: boolean;
  actionRequired?: string;
}

interface HealthLog {
  id: string;
  checked_at: string;
  overall_status: string;
  critical_count: number;
  warning_count: number;
  auto_fixed: string[];
  results: HealthResult[];
}

const serviceIcons: Record<string, React.ElementType> = {
  "Database": Database,
  "Email (Resend)": Mail,
  "SMS Gateway": MessageSquare,
  "Applicant Pipeline": Users,
  "Production Logging": BarChart3,
  "Authentication": Lock,
  "Realtime Subscriptions": Radio,
  "Agent Data Integrity": Users,
  "Stripe Payments": CreditCard,
};

function getServiceIcon(name: string) {
  for (const [key, Icon] of Object.entries(serviceIcons)) {
    if (name.includes(key)) return Icon;
  }
  if (name.startsWith("Storage")) return HardDrive;
  if (name.startsWith("Cron")) return Clock;
  return Zap;
}

interface DataQualityRow {
  issue: string;
  n: number | string | null;
  detail: string | null;
}

// Plain-language names + where to go. The view returns machine keys; a page
// that shows "interview_events_undispositioned_past" to a human is not a
// surface, it is a log line.
const DQ_LABELS: Record<string, { label: string; href?: string }> = {
  interview_events_undispositioned_past: {
    label: "Interviews held with no outcome recorded",
    href: "/dashboard/interview-recovery",
  },
  prospects_no_person_record: {
    label: "Booked prospects with no application on file",
    href: "/dashboard/interview-recovery",
  },
  applications_flagged_duplicate: { label: "Applications flagged as duplicates" },
  book_impossible_effective_future: { label: "Book rows dated in the future" },
  agents_hired_licensed_no_agentlink: {
    label: "Licensed agents with no AgentLink id",
    href: "/admin/missing-al-link",
  },
  agents_active_no_manager: { label: "Active agents with no manager" },
  interview_events_orphan_link: { label: "Interviews linked to a missing application" },
  applications_assigned_to_missing_agent: { label: "Applications assigned to a missing agent" },
  applications_no_owner_no_nextaction: { label: "Applications with no owner and no next action" },
  book_unattributed_inforce: { label: "In-force book rows with no agent" },
  // Keys the v_data_quality_dashboard view emits that had no human label (rendered
  // as raw snake_case before).
  agent_status_contradicts_production: { label: "Agents whose status contradicts their production" },
  agents_orphaned_no_manager: { label: "Agents with no manager", href: "/dashboard/agents" },
  agents_sharing_agentlink_id: { label: "Agents sharing one AgentLink id", href: "/admin/missing-al-link" },
  book_effective_date_implausible: { label: "Book rows with an implausible effective date" },
  book_rows_unattributed: { label: "Book rows with no agent (invisible to rollups)" },
  duplicate_active_agent_names: { label: "Active agents with duplicate names" },
  milestone_columns_bulk_backfilled: { label: "Applicants with bulk-backfilled milestone dates" },
  rls_overbroad_write_policies: { label: "Tables with overly broad write access" },
};

// Severity tokens — three levels only, always the -600 dark:-400 pair so they
// stay legible on the white light-theme card as well as the dark one.
const SEV_TEXT = {
  good: "text-emerald-600 dark:text-emerald-400",
  warn: "text-amber-600 dark:text-amber-400",
  bad: "text-rose-600 dark:text-rose-400",
} as const;

const SEV_DOT = {
  good: "bg-emerald-500",
  warn: "bg-amber-500",
  bad: "bg-rose-500",
} as const;

export default function SystemHealth() {
  const [results, setResults] = useState<HealthResult[]>([]);
  const [lastCheck, setLastCheck] = useState<HealthLog | null>(null);
  const [recentLogs, setRecentLogs] = useState<HealthLog[]>([]);
  const [running, setRunning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dq, setDq] = useState<DataQualityRow[] | null>(null);
  const [dqFailed, setDqFailed] = useState(false);

  const loadLastCheck = async () => {
    const { data } = await supabase
      .from("system_health_logs").select("id,checked_at,overall_status,critical_count,warning_count,auto_fixed,results")
      .order("checked_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) {
      const typed = data as unknown as HealthLog;
      setResults(typed.results || []);
      setLastCheck(typed);
    }
    setLoading(false);
  };

  const loadRecentLogs = async () => {
    const { data } = await supabase
      .from("system_health_logs").select("id,checked_at,overall_status,critical_count,warning_count,auto_fixed")
      .order("checked_at", { ascending: false })
      .limit(24);
    if (data) setRecentLogs(data as unknown as HealthLog[]);
  };

  const loadDataQuality = async () => {
    const { data, error } = await supabase
      .from("v_data_quality_dashboard" as any)
      .select("issue, n, detail");
    if (error) {
      setDqFailed(true);
      setDq(null);
      return;
    }
    setDqFailed(false);
    setDq((data as unknown as DataQualityRow[]) ?? null);
  };

  useEffect(() => {
    loadLastCheck();
    loadRecentLogs();
    loadDataQuality();
  }, []);

  const runCheck = async () => {
    setRunning(true);
    toast.info("Running system health check...");
    try {
      const { data, error } = await supabase.functions.invoke("system-health-check");
      if (error) throw error;
      setResults(data.results);
      setLastCheck({ ...data, checked_at: data.checkedAt, id: "live" } as any);
      await loadRecentLogs();
      if (data.critical > 0) {
        toast.error(`${data.critical} critical issues found!`);
      } else if (data.warnings > 0) {
        toast.warning(`${data.warnings} warnings detected`);
      } else {
        toast.success("All systems operational!");
      }
    } catch (err) {
      toast.error("Health check failed: " + String(err));
    }
    setRunning(false);
  };

  const criticalCount = lastCheck?.critical_count || 0;
  const warningCount = lastCheck?.warning_count || 0;
  const overallSeverity = criticalCount > 0 ? "bad" : warningCount > 0 ? "warn" : "good";

  if (loading) return <SkeletonLoader variant="page" />;

  return (
    <div className="page-enter mx-auto w-full max-w-6xl space-y-5 px-4 pb-24 sm:px-6">
      <PageHeader
        accent="cyan"
        eyebrow="Admin · Operations"
        eyebrowIcon={<Shield className="h-3 w-3" />}
        title="System Health"
        subtitle="Self-healing monitoring & diagnostics across every sync, cron, and integration."
        actions={
          <Badge
            variant={criticalCount > 0 ? "destructive" : warningCount > 0 ? "default" : "outline"}
            className="text-xs tabular-nums"
          >
            {criticalCount} critical · {warningCount} warning
          </Badge>
        }
      />

      {/* MP-268 — Data quality. Service health answers "is the pipe up";
          this answers "is what came through the pipe usable". Rows with a
          count of 0 are hidden so the list is only ever work to do. */}
      {(dq || dqFailed) && (
        <GlassCard className="p-4">
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
              <AlertTriangle className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="truncate">Data quality</span>
            </h3>
          </div>
          <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
            Records that exist but cannot be acted on. Each one is a person or a
            policy the system currently cannot route.
          </p>

          {dqFailed && (
            <p className={cn("flex items-start gap-2 text-xs leading-relaxed", SEV_TEXT.warn)}>
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="min-w-0">
                Could not read the data-quality view — these counts are missing,
                not zero.
              </span>
            </p>
          )}

          {dq && dq.filter((r) => Number(r.n ?? 0) > 0).length === 0 && (
            <p className={cn("flex items-start gap-2 text-xs leading-relaxed", SEV_TEXT.good)}>
              <CheckCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="min-w-0">
                Every checked record has an owner, a link, and a usable date.
              </span>
            </p>
          )}

          {dq && dq.filter((r) => Number(r.n ?? 0) > 0).length > 0 && (
            <ul className="space-y-2">
              {dq
                .filter((r) => Number(r.n ?? 0) > 0)
                .sort((a, b) => Number(b.n ?? 0) - Number(a.n ?? 0))
                .map((r) => {
                  const meta = DQ_LABELS[r.issue];
                  const count = Number(r.n ?? 0);
                  const body = (
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-foreground">
                          {meta?.label ?? r.issue}
                        </div>
                        {r.detail && (
                          <div className="mt-0.5 truncate text-[11px] tabular-nums text-muted-foreground">
                            {r.detail}
                          </div>
                        )}
                      </div>
                      <span className={cn("shrink-0 text-sm font-bold tabular-nums", SEV_TEXT.warn)}>
                        {count.toLocaleString()}
                      </span>
                    </div>
                  );
                  return (
                    <li key={r.issue}>
                      {meta?.href ? (
                        <Link
                          to={meta.href}
                          className="block rounded-lg border border-border/60 bg-card/60 px-3 py-2.5 transition-colors hover:border-border hover:bg-card focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]"
                        >
                          {body}
                        </Link>
                      ) : (
                        <div className="rounded-lg border border-border/60 bg-card/60 px-3 py-2.5">
                          {body}
                        </div>
                      )}
                    </li>
                  );
                })}
            </ul>
          )}
        </GlassCard>
      )}

      {/* Status Banner */}
      <div
        className={cn(
          "rounded-lg border p-3 sm:p-4",
          overallSeverity === "bad" && "border-rose-500/35 bg-rose-500/5",
          overallSeverity === "warn" && "border-amber-500/35 bg-amber-500/5",
          overallSeverity === "good" && "border-emerald-500/35 bg-emerald-500/5",
        )}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <span aria-hidden className={cn("h-2 w-2 shrink-0 rounded-full", SEV_DOT[overallSeverity])} />
            <div className="min-w-0">
              <div className={cn("text-sm font-semibold tabular-nums", SEV_TEXT[overallSeverity])}>
                {criticalCount > 0 ? `${criticalCount} Critical Issue${criticalCount > 1 ? "s" : ""}` :
                 warningCount > 0 ? `${warningCount} Warning${warningCount > 1 ? "s" : ""}` :
                 "All Systems Operational"}
              </div>
              <div className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
                Last checked: {lastCheck ? format(new Date(lastCheck.checked_at), "MMM d, h:mm a") : "Never"}
              </div>
            </div>
          </div>
          <Button
            size="sm"
            onClick={runCheck}
            disabled={running}
            className="h-10 w-full shrink-0 gap-2 sm:h-9 sm:w-auto"
          >
            <RefreshCw className={cn("h-4 w-4", running && "animate-spin")} />
            {running ? "Checking..." : "Run Check Now"}
          </Button>
        </div>
      </div>

      {/* Auto-fixed items */}
      {lastCheck?.auto_fixed && lastCheck.auto_fixed.length > 0 && (
        <GlassCard className="p-4">
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
              <Zap className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="truncate">Auto-Fixed</span>
            </h3>
            <span className={cn("shrink-0 text-sm font-bold tabular-nums", SEV_TEXT.good)}>
              {lastCheck.auto_fixed.length}
            </span>
          </div>
          <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
            Faults the last run repaired on its own. Nothing in this list is
            waiting on you.
          </p>
          <ul className="space-y-2">
            {lastCheck.auto_fixed.map((fix) => (
              <li key={fix} className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
                <CheckCircle className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", SEV_TEXT.good)} />
                <span className="min-w-0 break-words">{fix}</span>
              </li>
            ))}
          </ul>
        </GlassCard>
      )}

      {/* Service Cards Grid */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {results.map((result) => {
          const Icon = getServiceIcon(result.service);
          return (
            <GlassCard
              key={result.service}
              className={cn(
                "p-4",
                result.status === "down" && "border-rose-500/35",
                result.status === "degraded" && "border-amber-500/35",
              )}
            >
              <div className="flex items-start gap-3">
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 truncate text-sm font-medium text-foreground">{result.service}</span>
                    <Badge
                      variant={result.status === "healthy" ? "default" : result.status === "degraded" ? "secondary" : "destructive"}
                      className="h-5 shrink-0 text-[10px]"
                    >
                      {result.status === "healthy" ? <CheckCircle className="mr-1 h-3 w-3" /> :
                       result.status === "degraded" ? <AlertTriangle className="mr-1 h-3 w-3" /> :
                       <XCircle className="mr-1 h-3 w-3" />}
                      {result.status}
                    </Badge>
                    {result.autoFixed && (
                      <Badge
                        variant="outline"
                        className={cn("h-5 shrink-0 border-emerald-500/30 text-[10px]", SEV_TEXT.good)}
                      >
                        auto-fixed
                      </Badge>
                    )}
                  </div>
                  <div className="mt-1 break-words text-[11px] leading-relaxed text-muted-foreground">
                    {result.message}
                  </div>
                  {result.responseTime > 0 && (
                    <div className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
                      Response: {result.responseTime}ms
                    </div>
                  )}
                  {result.requiresAction && result.actionRequired && (
                    <div className={cn("mt-1.5 flex items-start gap-2 text-[11px] leading-relaxed", SEV_TEXT.bad)}>
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span className="min-w-0 break-words">{result.actionRequired}</span>
                    </div>
                  )}
                </div>
              </div>
            </GlassCard>
          );
        })}
      </div>

      {/* Recent Health Logs */}
      {recentLogs.length > 0 && (
        <GlassCard className="p-4">
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
              <Clock className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="truncate">Recent Health Checks</span>
            </h3>
          </div>
          <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
            The most recent runs, newest first. A row with a non-zero critical
            count is a window where something was down and nobody was watching.
          </p>
          <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                  <th className="px-2 py-2 text-left">Time</th>
                  <th className="px-2 py-2 text-left">Status</th>
                  <th className="px-2 py-2 text-right">Critical</th>
                  <th className="px-2 py-2 text-right">Warnings</th>
                  <th className="px-2 py-2 text-right">Auto-Fixed</th>
                </tr>
              </thead>
              <tbody>
                {recentLogs.map((log) => (
                  <tr key={log.id} className="border-b border-border/60 transition-colors hover:bg-muted/30">
                    <td className="whitespace-nowrap px-2 py-2 tabular-nums text-foreground">
                      {format(new Date(log.checked_at), "MMM d, h:mm a")}
                    </td>
                    <td className="px-2 py-2">
                      <span className={cn(
                        "inline-flex items-center gap-2 whitespace-nowrap font-medium",
                        log.overall_status === "healthy" ? SEV_TEXT.good :
                        log.overall_status === "degraded" ? SEV_TEXT.warn : SEV_TEXT.bad,
                      )}>
                        <span aria-hidden className={cn(
                          "h-2 w-2 shrink-0 rounded-full",
                          log.overall_status === "healthy" ? SEV_DOT.good :
                          log.overall_status === "degraded" ? SEV_DOT.warn : SEV_DOT.bad,
                        )} />
                        {log.overall_status}
                      </span>
                    </td>
                    <td className={cn(
                      "px-2 py-2 text-right font-semibold tabular-nums",
                      log.critical_count > 0 ? SEV_TEXT.bad : "text-muted-foreground",
                    )}>
                      {log.critical_count}
                    </td>
                    <td className={cn(
                      "px-2 py-2 text-right font-semibold tabular-nums",
                      log.warning_count > 0 ? SEV_TEXT.warn : "text-muted-foreground",
                    )}>
                      {log.warning_count}
                    </td>
                    <td className={cn(
                      "px-2 py-2 text-right font-semibold tabular-nums",
                      (log.auto_fixed?.length || 0) > 0 ? SEV_TEXT.good : "text-muted-foreground",
                    )}>
                      {log.auto_fixed?.length || 0}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </GlassCard>
      )}

      {/* New observability panels — populated as functions migrate to createHandler() */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <ClientErrorsPanel />
        <FunctionErrorsPanel />
        <AuditLogPanel />
      </div>
    </div>
  );
}
