import { useState, useEffect } from "react";
import { Activity, CheckCircle, AlertTriangle, XCircle, RefreshCw } from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

interface HealthCheck {
  check_name: string;
  status: string;
  response_time_ms: number;
  created_at: string;
}

export function SystemHealthMonitor() {
  const [checks, setChecks] = useState<HealthCheck[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchHealth = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("health_check_log")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(10);
    setChecks(data || []);
    setLoading(false);
  };

  useEffect(() => { fetchHealth(); }, []);

  const runHealthCheck = async () => {
    setLoading(true);
    await supabase.functions.invoke("system-health-check");
    await fetchHealth();
  };

  const statusIcon = (status: string) => {
    if (status === "ok" || status === "healthy") return <CheckCircle className="h-4 w-4 text-emerald-400" />;
    if (status === "warning") return <AlertTriangle className="h-4 w-4 text-amber-400" />;
    return <XCircle className="h-4 w-4 text-red-400" />;
  };

  const overallStatus = checks.length === 0 ? "unknown" :
    checks.some(c => c.status === "error") ? "error" :
    checks.some(c => c.status === "warning") ? "warning" : "healthy";

  return (
    <GlassCard className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-display font-semibold flex items-center gap-2 text-sm">
          <Activity className="h-4 w-4 text-primary" />
          System Health
        </h3>
        <div className="flex items-center gap-2">
          <Badge className={cn("text-[10px]",
            overallStatus === "healthy" && "bg-emerald-500/20 text-emerald-400",
            overallStatus === "warning" && "bg-amber-500/20 text-amber-400",
            overallStatus === "error" && "bg-red-500/20 text-red-400",
            overallStatus === "unknown" && "bg-muted text-muted-foreground",
          )}>
            {overallStatus.toUpperCase()}
          </Badge>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={runHealthCheck} disabled={loading}>
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          </Button>
        </div>
      </div>
      {checks.length > 0 ? (
        <div className="space-y-1.5">
          {checks.slice(0, 5).map((c, i) => (
            <div key={i} className="flex items-center gap-2 text-xs p-1.5 rounded bg-card/50">
              {statusIcon(c.status)}
              <span className="flex-1 truncate">{c.check_name}</span>
              <span className="text-muted-foreground">{c.response_time_ms}ms</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground text-center py-2">No health checks yet</p>
      )}
    </GlassCard>
  );
}
