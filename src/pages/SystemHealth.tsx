import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
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
import { FunctionErrorsPanel, AuditLogPanel } from "@/components/system-health/ObservabilityPanels";

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
};

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

  if (loading) return <SkeletonLoader variant="page" />;

  return (
    <div className="max-w-5xl mx-auto space-y-6 p-4 md:p-6">
      <PageHeader
        accent="cyan"
        eyebrow="Admin · Operations"
        eyebrowIcon={<Shield className="h-3 w-3" />}
        title="System Health"
        subtitle="Self-healing monitoring & diagnostics across every sync, cron, and integration."
        actions={
          <>
            <Badge variant={criticalCount > 0 ? "destructive" : warningCount > 0 ? "default" : "outline"} className="text-xs">
              {criticalCount} critical · {warningCount} warning
            </Badge>
          </>
        }
      />

      {/* MP-268 — Data quality. Service health answers "is the pipe up";
          this answers "is what came through the pipe usable". Rows with a
          count of 0 are hidden so the list is only ever work to do. */}
      {(dq || dqFailed) && (
        <GlassCard className="p-4">
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold text-foreground">Data quality</h3>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            Records that exist but cannot be acted on. Each one is a person or a
            policy the system currently cannot route.
          </p>

          {dqFailed && (
            <p className="text-xs text-amber-500">
              Could not read the data-quality view — these counts are missing,
              not zero.
            </p>
          )}

          {dq && dq.filter((r) => Number(r.n ?? 0) > 0).length === 0 && (
            <p className="text-xs text-emerald-500">
              Every checked record has an owner, a link, and a usable date.
            </p>
          )}

          {dq && dq.filter((r) => Number(r.n ?? 0) > 0).length > 0 && (
            <div className="space-y-1.5">
              {dq
                .filter((r) => Number(r.n ?? 0) > 0)
                .sort((a, b) => Number(b.n ?? 0) - Number(a.n ?? 0))
                .map((r) => {
                  const meta = DQ_LABELS[r.issue];
                  const count = Number(r.n ?? 0);
                  const body = (
                    <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2">
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-foreground truncate">
                          {meta?.label ?? r.issue}
                        </div>
                        {r.detail && (
                          <div className="text-[10px] text-muted-foreground truncate">
                            {r.detail}
                          </div>
                        )}
                      </div>
                      <span className="text-sm font-bold tabular-nums text-amber-500 flex-shrink-0">
                        {count.toLocaleString()}
                      </span>
                    </div>
                  );
                  return meta?.href ? (
                    <Link key={r.issue} to={meta.href} className="block hover:opacity-80">
                      {body}
                    </Link>
                  ) : (
                    <div key={r.issue}>{body}</div>
                  );
                })}
            </div>
          )}
        </GlassCard>
      )}

      {/* Status Banner */}
      <div className={`p-4 rounded-md flex items-center gap-3 border ${
        criticalCount > 0 ? "bg-red-500/10 border-red-500/30" :
        warningCount > 0 ? "bg-yellow-500/10 border-yellow-500/30" :
        "bg-emerald-500/10 border-emerald-500/30"
      }`}>
        <div className={`w-3 h-3 rounded-full animate-pulse ${
          criticalCount > 0 ? "bg-red-500" : warningCount > 0 ? "bg-yellow-500" : "bg-emerald-500"
        }`} />
        <div className="flex-1">
          <div className="font-bold text-sm">
            {criticalCount > 0 ? `${criticalCount} Critical Issue${criticalCount > 1 ? "s" : ""}` :
             warningCount > 0 ? `${warningCount} Warning${warningCount > 1 ? "s" : ""}` :
             "All Systems Operational"}
          </div>
          <div className="text-xs text-muted-foreground">
            Last checked: {lastCheck ? format(new Date(lastCheck.checked_at), "MMM d, h:mm a") : "Never"}
          </div>
        </div>
        <Button size="sm" onClick={runCheck} disabled={running} className="gap-2">
          <RefreshCw className={`h-3.5 w-3.5 ${running ? "animate-spin" : ""}`} />
          {running ? "Checking..." : "Run Check Now"}
        </Button>
      </div>

      {/* Auto-fixed items */}
      {lastCheck?.auto_fixed && lastCheck.auto_fixed.length > 0 && (
        <GlassCard className="p-4">
          <div className="text-xs font-bold text-emerald-400 mb-2 flex items-center gap-2">
            <Zap className="h-3.5 w-3.5" />
            Auto-Fixed ({lastCheck.auto_fixed.length})
          </div>
          <div className="space-y-1">
            {lastCheck.auto_fixed.map((fix) => (
              <div key={fix} className="text-xs text-emerald-400/80 flex items-center gap-2">
                <CheckCircle className="h-3 w-3 shrink-0" />
                {fix}
              </div>
            ))}
          </div>
        </GlassCard>
      )}

      {/* Service Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {results.map((result) => {
          const Icon = getServiceIcon(result.service);
          return (
            <GlassCard key={result.service} className="p-4">
              <div className="flex items-start gap-3">
                <div className={`p-2 rounded-lg ${
                  result.status === "healthy" ? "bg-emerald-500/10 text-emerald-400" :
                  result.status === "degraded" ? "bg-yellow-500/10 text-amber-500" :
                  "bg-red-500/10 text-red-400"
                }`}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm truncate">{result.service}</span>
                    <Badge variant={result.status === "healthy" ? "default" : result.status === "degraded" ? "secondary" : "destructive"} className="text-[10px] h-5">
                      {result.status === "healthy" ? <CheckCircle className="h-3 w-3 mr-1" /> :
                       result.status === "degraded" ? <AlertTriangle className="h-3 w-3 mr-1" /> :
                       <XCircle className="h-3 w-3 mr-1" />}
                      {result.status}
                    </Badge>
                    {result.autoFixed && (
                      <Badge variant="outline" className="text-[10px] h-5 text-emerald-400 border-emerald-400/30">auto-fixed</Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">{result.message}</div>
                  {result.responseTime > 0 && (
                    <div className="text-[10px] text-muted-foreground mt-0.5">Response: {result.responseTime}ms</div>
                  )}
                  {result.requiresAction && result.actionRequired && (
                    <div className="text-xs text-red-400 mt-1.5 flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3 shrink-0" />
                      {result.actionRequired}
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
          <h3 className="font-bold text-sm mb-3 flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            Recent Health Checks
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/50">
                  <th className="text-left pb-2 font-medium text-muted-foreground">Time</th>
                  <th className="text-left pb-2 font-medium text-muted-foreground">Status</th>
                  <th className="text-center pb-2 font-medium text-muted-foreground">Critical</th>
                  <th className="text-center pb-2 font-medium text-muted-foreground">Warnings</th>
                  <th className="text-center pb-2 font-medium text-muted-foreground">Auto-Fixed</th>
                </tr>
              </thead>
              <tbody>
                {recentLogs.map((log) => (
                  <tr key={log.id} className="border-b border-border/20 hover:bg-muted/30">
                    <td className="py-2">{format(new Date(log.checked_at), "MMM d, h:mm a")}</td>
                    <td className="py-2">
                      <span className={`inline-flex items-center gap-1 ${
                        log.overall_status === "healthy" ? "text-emerald-400" :
                        log.overall_status === "degraded" ? "text-amber-500" : "text-red-400"
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${
                          log.overall_status === "healthy" ? "bg-emerald-400" :
                          log.overall_status === "degraded" ? "bg-yellow-400" : "bg-red-400"
                        }`} />
                        {log.overall_status}
                      </span>
                    </td>
                    <td className="py-2 text-center">{log.critical_count}</td>
                    <td className="py-2 text-center">{log.warning_count}</td>
                    <td className="py-2 text-center">{log.auto_fixed?.length || 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </GlassCard>
      )}

      {/* New observability panels — populated as functions migrate to createHandler() */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <FunctionErrorsPanel />
        <AuditLogPanel />
      </div>
    </div>
  );
}
