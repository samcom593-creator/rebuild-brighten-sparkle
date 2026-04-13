import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SkeletonLoader } from "@/components/ui/skeleton-loader";
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

export default function SystemHealth() {
  const [results, setResults] = useState<HealthResult[]>([]);
  const [lastCheck, setLastCheck] = useState<HealthLog | null>(null);
  const [recentLogs, setRecentLogs] = useState<HealthLog[]>([]);
  const [running, setRunning] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadLastCheck = async () => {
    const { data } = await supabase
      .from("system_health_logs")
      .select("*")
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
      .from("system_health_logs")
      .select("*")
      .order("checked_at", { ascending: false })
      .limit(24);
    if (data) setRecentLogs(data as unknown as HealthLog[]);
  };

  useEffect(() => {
    loadLastCheck();
    loadRecentLogs();
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
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Shield className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">System Health</h1>
          <p className="text-xs text-muted-foreground">Self-healing monitoring & diagnostics</p>
        </div>
      </div>

      {/* Status Banner */}
      <div className={`p-4 rounded-xl flex items-center gap-3 border ${
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
            {lastCheck.auto_fixed.map((fix, i) => (
              <div key={i} className="text-xs text-emerald-400/80 flex items-center gap-2">
                <CheckCircle className="h-3 w-3 shrink-0" />
                {fix}
              </div>
            ))}
          </div>
        </GlassCard>
      )}

      {/* Service Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {results.map((result, i) => {
          const Icon = getServiceIcon(result.service);
          return (
            <GlassCard key={i} className="p-4">
              <div className="flex items-start gap-3">
                <div className={`p-2 rounded-lg ${
                  result.status === "healthy" ? "bg-emerald-500/10 text-emerald-400" :
                  result.status === "degraded" ? "bg-yellow-500/10 text-yellow-400" :
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
                        log.overall_status === "degraded" ? "text-yellow-400" : "text-red-400"
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
    </div>
  );
}
