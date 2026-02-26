import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/ui/glass-card";
import { DollarSign, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  currentAgentId: string;
}

export function EstimatedEarningsCard({ currentAgentId }: Props) {
  const { data } = useQuery({
    queryKey: ["estimated-earnings", currentAgentId],
    queryFn: async () => {
      // Get current month start
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];

      // Get all agents
      const { data: agents } = await supabase
        .from("agents")
        .select("id");

      if (!agents?.length) return null;

      const agentIds = agents.map(a => a.id);

      // Get monthly production
      const { data: prod } = await supabase
        .from("daily_production")
        .select("agent_id, aop")
        .in("agent_id", agentIds)
        .gte("production_date", monthStart);

      if (!prod?.length) return null;

      let adminAOP = 0;
      let othersAOP = 0;

      for (const p of prod) {
        const alp = Number(p.aop) || 0;
        if (p.agent_id === currentAgentId) {
          adminAOP += alp;
        } else {
          othersAOP += alp;
        }
      }

      const overrideEarnings = othersAOP * (9 / 12) * 0.5;
      const personalEarnings = adminAOP * (9 / 12) * 1.2;
      const total = overrideEarnings + personalEarnings;

      return { adminAOP, othersAOP, overrideEarnings, personalEarnings, total };
    },
    staleTime: 120_000,
  });

  if (!data || data.total === 0) return null;

  return (
    <GlassCard className="p-5 border-primary/20 relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-emerald-500/5 pointer-events-none" />
      <div className="relative z-10">
        <div className="flex items-center gap-2 mb-3">
          <div className="p-1.5 rounded-lg bg-primary/15">
            <DollarSign className="h-4 w-4 text-primary" />
          </div>
          <h3 className="text-sm font-bold tracking-wide uppercase text-muted-foreground">
            Estimated Earnings
          </h3>
          <TrendingUp className="h-3.5 w-3.5 text-emerald-500 ml-auto" />
        </div>

        <p className="text-3xl font-black bg-gradient-to-r from-primary to-emerald-500 bg-clip-text text-transparent mb-3">
          ${Math.round(data.total).toLocaleString()}
        </p>

        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="p-2.5 rounded-lg bg-muted/50">
            <p className="text-muted-foreground">Personal</p>
            <p className="font-bold text-foreground">${Math.round(data.personalEarnings).toLocaleString()}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">AOP: ${data.adminAOP.toLocaleString()}</p>
          </div>
          <div className="p-2.5 rounded-lg bg-muted/50">
            <p className="text-muted-foreground">Override</p>
            <p className="font-bold text-foreground">${Math.round(data.overrideEarnings).toLocaleString()}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">Team AOP: ${data.othersAOP.toLocaleString()}</p>
          </div>
        </div>
      </div>
    </GlassCard>
  );
}
