import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { subDays, format } from "date-fns";

export function ActivationRiskBanner() {
  const { data: atRiskCount } = useQuery({
    queryKey: ["activation-risk-count"],
    queryFn: async () => {
      // Get all active agents
      const { data: agents } = await supabase
        .from("agents")
        .select("id")
        .eq("status", "active")
        .eq("is_deactivated", false);

      if (!agents || agents.length === 0) return 0;

      const cutoff = format(subDays(new Date(), 14), "yyyy-MM-dd");
      const agentIds = agents.map((a) => a.id);

      // Get agents with recent production
      const { data: recentProd } = await supabase
        .from("daily_production")
        .select("agent_id")
        .in("agent_id", agentIds)
        .gte("production_date", cutoff);

      const activeAgentIds = new Set(recentProd?.map((p) => p.agent_id) || []);
      return agentIds.filter((id) => !activeAgentIds.has(id)).length;
    },
    staleTime: 300_000,
  });

  if (!atRiskCount || atRiskCount === 0) return null;

  return (
    <GlassCard className="p-3 border-amber-500/30 bg-amber-500/5">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
        <span className="text-sm font-medium text-amber-400">Activation Risk</span>
        <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-[10px] ml-auto">
          {atRiskCount} agent{atRiskCount > 1 ? "s" : ""}
        </Badge>
      </div>
      <p className="text-[11px] text-muted-foreground mt-1 pl-6">
        {atRiskCount} agent{atRiskCount > 1 ? "s have" : " has"} no production entries in 14+ days
      </p>
    </GlassCard>
  );
}
