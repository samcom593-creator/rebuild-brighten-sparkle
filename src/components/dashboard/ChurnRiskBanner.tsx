import { useState, useEffect } from "react";
import { AlertTriangle, Shield, X, ChevronDown, ChevronUp } from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

interface ChurnAlert {
  id: string;
  agent_id: string;
  risk_score: number;
  risk_tier: string;
  risk_factors: string[];
  created_at: string;
  agent_name?: string;
}

export function ChurnRiskBanner() {
  const [alerts, setAlerts] = useState<ChurnAlert[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("churn_risk_alerts")
        .select("*")
        .is("resolved_at", null)
        .order("risk_score", { ascending: false })
        .limit(20);

      if (data && data.length > 0) {
        const agentIds = [...new Set(data.map((a: any) => a.agent_id))];
        const { data: agents } = await supabase
          .from("agents")
          .select("id, display_name, profiles!agents_profile_id_fkey(full_name)")
          .in("id", agentIds);

        const nameMap = new Map<string, string>();
        (agents || []).forEach((a: any) => {
          nameMap.set(a.id, a.profiles?.full_name || a.display_name || "Unknown");
        });

        setAlerts(data.map((a: any) => ({
          ...a,
          risk_factors: Array.isArray(a.risk_factors) ? a.risk_factors : [],
          agent_name: nameMap.get(a.agent_id) || "Unknown",
        })));
      }
    })();
  }, []);

  if (alerts.length === 0 || dismissed) return null;

  const criticalCount = alerts.filter(a => a.risk_tier === "critical").length;
  const highCount = alerts.filter(a => a.risk_tier === "high").length;

  return (
    <GlassCard className={cn(
      "p-4 border-l-4",
      criticalCount > 0 ? "border-l-red-500" : "border-l-amber-500"
    )}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Shield className={cn("h-5 w-5", criticalCount > 0 ? "text-red-400" : "text-amber-400")} />
          <div>
            <h3 className="font-display font-semibold text-sm">Churn Risk Alert</h3>
            <p className="text-xs text-muted-foreground">
              {alerts.length} agent{alerts.length !== 1 ? "s" : ""} at risk
              {criticalCount > 0 && <span className="text-red-400 ml-1">({criticalCount} critical)</span>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setExpanded(!expanded)}>
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setDismissed(true)}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="mt-3 space-y-2 max-h-48 overflow-y-auto">
          {alerts.slice(0, 10).map(alert => (
            <div key={alert.id} className="flex items-center gap-3 p-2 rounded-lg bg-card/50 border border-border text-xs">
              <Badge className={cn("text-[10px]",
                alert.risk_tier === "critical" && "bg-red-500/20 text-red-400",
                alert.risk_tier === "high" && "bg-orange-500/20 text-orange-400",
                alert.risk_tier === "medium" && "bg-amber-500/20 text-amber-400",
              )}>
                {alert.risk_score}
              </Badge>
              <span className="font-medium">{alert.agent_name}</span>
              <span className="text-muted-foreground flex-1 truncate">
                {alert.risk_factors[0] || "At risk"}
              </span>
            </div>
          ))}
        </div>
      )}
    </GlassCard>
  );
}
