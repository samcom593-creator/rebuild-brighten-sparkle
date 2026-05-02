import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Users, DollarSign, Target, TrendingUp, Calendar } from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, subDays } from "date-fns";
import { cn } from "@/lib/utils";
import { DateRangePicker, DateRange } from "@/components/ui/date-range-picker";
import { getMetricBounds } from "@/lib/metricTruth";

type TimePeriod = "week" | "month" | "custom";

interface DownlineStats {
  totalALP: number;
  totalDeals: number;
  agentCount: number;
  avgCloseRate: number;
}

export function DownlineStatsCard() {
  const { user, isAdmin } = useAuth();
  const [period, setPeriod] = useState<TimePeriod>("week");
  const [customRange, setCustomRange] = useState<DateRange>({
    from: subDays(new Date(), 30),
    to: new Date(),
  });
  const [stats, setStats] = useState<DownlineStats>({
    totalALP: 0,
    totalDeals: 0,
    agentCount: 0,
    avgCloseRate: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchDownlineStats = async () => {
      if (!user) return;

      try {
        setLoading(true);
        
        // Get current user's agent ID
        const { data: currentAgent } = await supabase
          .from("agents")
          .select("id")
          .eq("user_id", user.id)
          .eq("is_deactivated", false)
          .maybeSingle();

        if (!currentAgent) {
          setLoading(false);
          return;
        }

        let agentIds: string[] = [];

        // For admins, fetch ALL active agents (not just direct reports)
        if (isAdmin) {
          const { data: allAgents } = await supabase
            .from("agents")
            .select("id")
            .eq("is_deactivated", false)
            .neq("id", currentAgent.id);

          agentIds = allAgents?.map(a => a.id) || [];
        } else {
          // For managers, fetch only direct reports
          const { data: downlineAgents } = await supabase
            .from("agents")
            .select("id")
            .eq("invited_by_manager_id", currentAgent.id)
            .eq("is_deactivated", false);

          agentIds = downlineAgents?.map(a => a.id) || [];
        }

        if (agentIds.length === 0) {
          setLoading(false);
          return;
        }

        const bounds = getMetricBounds(
          period === "custom" ? "custom" : period,
          customRange.from && customRange.to
            ? { from: customRange.from, to: customRange.to }
            : undefined,
        );
        const startDate = bounds.startIso.slice(0, 10);
        const endDate = new Date(bounds.end.getTime() - 1_000).toISOString().slice(0, 10);

        // ALP + deals come from posted deals in the canonical truth layer.
        // Presentations stay on daily_production because that is still their
        // authoritative source.
        const [dealsRes, presRes] = await Promise.all([
          supabase
            .from("deals")
            .select("annual_premium, agent_id")
            .in("agent_id", agentIds)
            .gte("posted_at", bounds.startIso)
            .lt("posted_at", bounds.endIso)
            .in("status", ["submitted", "active"]),
          supabase
            .from("daily_production")
            .select("presentations")
            .in("agent_id", agentIds)
            .gte("production_date", startDate)
            .lte("production_date", endDate),
        ]);

        const dealsData = (dealsRes.data || []) as any[];
        const totalALP = dealsData.reduce((sum, d) => sum + (Number(d.annual_premium) || 0), 0);
        const totalDeals = dealsData.length;
        const totalPresentations = (presRes.data || []).reduce(
          (sum: number, p: any) => sum + (Number(p.presentations) || 0),
          0,
        );
        const avgCloseRate = totalPresentations > 0
          ? Math.round((totalDeals / totalPresentations) * 100)
          : 0;

        setStats({
          totalALP,
          totalDeals,
          agentCount: agentIds.length,
          avgCloseRate,
        });
      } catch (error) {
        console.error("Error fetching downline stats:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchDownlineStats();
  }, [user?.id, isAdmin, period, customRange]);

  if (loading && stats.agentCount === 0) {
    return null;
  }

  if (stats.agentCount === 0 && !loading) {
    return null;
  }

  const periodLabels: Record<TimePeriod, string> = {
    week: "This Week",
    month: "This Month",
    custom: customRange.from && customRange.to 
      ? `${format(customRange.from, "MMM d")} - ${format(customRange.to, "MMM d")}`
      : "Custom Range",
  };

  const label = isAdmin ? "Agency Production" : "Team Production";

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2 }}
    >
      <GlassCard className="p-5">
        <div className="flex items-center justify-between mb-4 gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Users className="h-5 w-5 text-primary shrink-0" />
            <h3 className="font-semibold truncate">{label}</h3>
            <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
              ({periodLabels[period]})
            </span>
          </div>
          
          {/* Time Toggle */}
          <div className="flex items-center gap-1 shrink-0">
            <div className="flex items-center gap-0.5 bg-muted/50 rounded-md p-0.5">
              {(["week", "month", "custom"] as TimePeriod[]).map((p) => (
                <Button
                  key={p}
                  variant={period === p ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setPeriod(p)}
                  className={cn(
                    "text-[10px] h-6 px-2 whitespace-nowrap",
                    period === p && "bg-primary text-primary-foreground"
                  )}
                >
                  {p === "week" ? "W" : p === "month" ? "M" : "Custom"}
                </Button>
              ))}
            </div>
            {period === "custom" && (
              <DateRangePicker
                value={customRange}
                onChange={setCustomRange}
                simpleMode
                className="scale-90 origin-left"
              />
            )}
          </div>
        </div>

        
        <div className="grid grid-cols-3 gap-4">
          <div className="text-center">
            <div className="flex items-center justify-center gap-1 text-primary mb-1">
              <DollarSign className="h-4 w-4" />
            </div>
            <p className="text-2xl font-bold">${stats.totalALP.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground">Total ALP</p>
          </div>
          
          <div className="text-center">
            <div className="flex items-center justify-center gap-1 text-emerald-400 mb-1">
              <Target className="h-4 w-4" />
            </div>
            <p className="text-2xl font-bold">{stats.totalDeals}</p>
            <p className="text-xs text-muted-foreground">Deals</p>
          </div>
          
          <div className="text-center">
            <div className="flex items-center justify-center gap-1 text-violet-400 mb-1">
              <TrendingUp className="h-4 w-4" />
            </div>
            <p className="text-2xl font-bold">{stats.avgCloseRate}%</p>
            <p className="text-xs text-muted-foreground">Close Rate</p>
          </div>
        </div>
      </GlassCard>
    </motion.div>
  );
}
