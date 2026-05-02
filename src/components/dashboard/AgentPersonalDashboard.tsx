import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { StatCard } from "@/components/dashboard/StatCard";
import { DollarSign, TrendingUp, Target, Award, Sparkles, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { RealFinancesCard } from "@/components/finances/RealFinancesCard";
import { ExtendedStatsStrip } from "@/components/dashboard/ExtendedStatsStrip";
import { CompactLeaderboard } from "@/components/dashboard/CompactLeaderboard";
import { getBusinessMonthBounds, getBusinessWeekBounds } from "@/lib/dateUtils";
import { sumAnnualPremium, getCloseRate } from "@/lib/metricTruth";

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

      const weekBounds = getBusinessWeekBounds();
      const monthBounds = getBusinessMonthBounds();

      // Pull this agent's own deals (posted_at + valid status) for ALP
      // and deal counts. Presentations stays on daily_production since
      // that's the only source.
      const [weekDealsRes, monthDealsRes, weekPresRes, estimateRes] = await Promise.all([
        supabase.from("deals")
          .select("annual_premium, posted_at")
          .eq("agent_id", agentId)
          .gte("posted_at", weekBounds.startIso)
          .lt("posted_at", weekBounds.endIso)
          .in("status", ["submitted", "active"]),
        supabase.from("deals")
          .select("annual_premium, posted_at")
          .eq("agent_id", agentId)
          .gte("posted_at", monthBounds.startIso)
          .lt("posted_at", monthBounds.endIso)
          .in("status", ["submitted", "active"]),
        supabase.from("daily_production")
          .select("presentations")
          .eq("agent_id", agentId)
          .gte("production_date", weekBounds.startIso.slice(0, 10))
          .lte("production_date", weekBounds.endIso.slice(0, 10)),
        supabase.from("agent_revenue_estimate" as any)
          .select("*")
          .eq("agent_id", agentId)
          .maybeSingle(),
      ]);

      const weekALP = sumAnnualPremium((weekDealsRes.data || []) as Array<{ annual_premium?: number | null }>);
      const weekDeals = (weekDealsRes.data || []).length;
      const weekPres = (weekPresRes.data || []).reduce((s, r: any) => s + (Number(r.presentations) || 0), 0);
      const monthALP = sumAnnualPremium((monthDealsRes.data || []) as Array<{ annual_premium?: number | null }>);
      const monthDeals = (monthDealsRes.data || []).length;

      return {
        weekALP, weekDeals, weekPres,
        monthALP, monthDeals,
        closeRate: getCloseRate(weekDeals, weekPres),
        estimate: estimateRes.data as any,
      };
    },
    enabled: !!agentId,
  });

  // Onboarding state — user has the "agent" role but no agents-table row yet.
  // Roughly half of role=agent users land here (no profile linkage) and previously
  // saw a fully blank dashboard. Show a welcome card + the live agency leaderboard
  // so they have something useful to look at.
  if (!agentId) {
    return (
      <div className="space-y-6">
        <div className="rounded-xl border border-primary/30 bg-gradient-to-br from-primary/10 via-background to-background p-6 reveal">
          <div className="flex items-start gap-3">
            <Sparkles className="h-6 w-6 text-primary mt-0.5" />
            <div className="flex-1">
              <h2 className="text-lg font-semibold">Welcome to APEX Financial</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Your agent profile is being finalized. While that finishes, here's the live agency leaderboard
                so you can see what the top closers are pulling.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button asChild size="sm" variant="default">
                  <Link to="/hall-of-fame">Hall of Fame <ArrowRight className="ml-1 h-3.5 w-3.5" /></Link>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <Link to="/leaderboard">Leaderboard</Link>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <Link to="/dashboard/today">Today</Link>
                </Button>
              </div>
            </div>
          </div>
        </div>
        <CompactLeaderboard />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs text-muted-foreground uppercase tracking-wide">Your week</p>
      </div>

      {/* Personal stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard title="My Weekly ALP" value={`$${(me?.weekALP || 0).toLocaleString()}`} icon={DollarSign} variant="success" hint="Calendar week-to-date" />
        <StatCard title="My Weekly Deals" value={me?.weekDeals || 0} icon={TrendingUp} variant="primary" />
        <StatCard title="My Monthly ALP" value={`$${(me?.monthALP || 0).toLocaleString()}`} icon={Target} variant="success" hint="Calendar month-to-date" />
        <StatCard title="My Close Rate" value={`${me?.closeRate || 0}%`} icon={Award} variant="default" />
      </div>

      {/* Personal extra numbers — today, pace, avg/deal, biggest, deltas */}
      <ExtendedStatsStrip agentId={agentId} title="My extra numbers" />

      {/* Real commissions (Insuracloud) */}
      <RealFinancesCard agentId={agentId} />
    </div>
  );
}
