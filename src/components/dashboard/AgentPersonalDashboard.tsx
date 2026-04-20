import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { StatCard } from "@/components/dashboard/StatCard";
import { DollarSign, TrendingUp, Target, Award } from "lucide-react";
import { RealFinancesCard } from "@/components/finances/RealFinancesCard";

interface Props {
  agentId?: string;
}

/**
 * The dashboard a plain agent sees — no team data, no agency data.
 * Everything is about them.
 */
export function AgentPersonalDashboard({ agentId }: Props) {
  const { data: me } = useQuery({
    queryKey: ["agent-personal-stats", agentId],
    queryFn: async () => {
      if (!agentId) return null;

      const now = new Date();
      const weekStart = new Date(now);
      const day = now.getDay();
      weekStart.setDate(now.getDate() + (day === 0 ? -6 : 1 - day));
      weekStart.setHours(0, 0, 0, 0);
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

      const [weekRes, monthRes, estimateRes] = await Promise.all([
        supabase.from("daily_production")
          .select("aop, deals_closed, presentations")
          .eq("agent_id", agentId)
          .gte("production_date", weekStart.toISOString().split("T")[0]),
        supabase.from("daily_production")
          .select("aop, deals_closed")
          .eq("agent_id", agentId)
          .gte("production_date", monthStart.toISOString().split("T")[0]),
        supabase.from("agent_revenue_estimate" as any)
          .select("*")
          .eq("agent_id", agentId)
          .maybeSingle(),
      ]);

      const weekALP = (weekRes.data || []).reduce((s, r: any) => s + (Number(r.aop) || 0), 0);
      const weekDeals = (weekRes.data || []).reduce((s, r: any) => s + (Number(r.deals_closed) || 0), 0);
      const weekPres = (weekRes.data || []).reduce((s, r: any) => s + (Number(r.presentations) || 0), 0);
      const monthALP = (monthRes.data || []).reduce((s, r: any) => s + (Number(r.aop) || 0), 0);
      const monthDeals = (monthRes.data || []).reduce((s, r: any) => s + (Number(r.deals_closed) || 0), 0);

      return {
        weekALP, weekDeals, weekPres,
        monthALP, monthDeals,
        closeRate: weekPres > 0 ? Math.round((weekDeals / weekPres) * 1000) / 10 : 0,
        estimate: estimateRes.data as any,
      };
    },
    enabled: !!agentId,
  });

  if (!agentId) return null;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs text-muted-foreground uppercase tracking-wide">Your week</p>
      </div>

      {/* Personal stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard title="My Weekly ALP" value={`$${(me?.weekALP || 0).toLocaleString()}`} icon={DollarSign} variant="success" />
        <StatCard title="My Weekly Deals" value={me?.weekDeals || 0} icon={TrendingUp} variant="primary" />
        <StatCard title="My Monthly ALP" value={`$${(me?.monthALP || 0).toLocaleString()}`} icon={Target} variant="success" />
        <StatCard title="My Close Rate" value={`${me?.closeRate || 0}%`} icon={Award} variant="default" />
      </div>

      {/* Real commissions (Insuracloud) */}
      <RealFinancesCard agentId={agentId} />
    </div>
  );
}
