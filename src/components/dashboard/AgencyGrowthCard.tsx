import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { Building2, UserCheck, Users, TrendingUp, Clock } from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { getTodayPST, getWeekStartPST, getMonthStartPST, getDateDaysAgoPST } from "@/lib/dateUtils";
import { useDebouncedRefetch } from "@/hooks/useDebouncedRefetch";

type Period = "day" | "week" | "month";

interface GrowthStats {
  licensedProducers: number;
  totalUnlicensed: number;
  newHires: number;
  licensedHires: number;
  unlicensedHires: number;
  inPipeline: number;
  growthPercent: number;
  avgDaysToLicensed: number | null;
}

export function AgencyGrowthCard() {
  const [period, setPeriod] = useState<Period>("week");
  const [stats, setStats] = useState<GrowthStats | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStats = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);

      let currentStart: string;
      let prevStart: string;
      let prevEnd: string;

      switch (period) {
        case "day":
          currentStart = getTodayPST();
          prevStart = getDateDaysAgoPST(1);
          prevEnd = getTodayPST();
          break;
        case "month":
          currentStart = getMonthStartPST();
          prevStart = getDateDaysAgoPST(60);
          prevEnd = getDateDaysAgoPST(30);
          break;
        default: // week
          currentStart = getWeekStartPST();
          prevStart = getDateDaysAgoPST(14);
          prevEnd = getDateDaysAgoPST(7);
      }

      // Parallel queries — include unlicensed apps + agent profile emails for dedup
      const [agentsRes, allUnlicensedAppsRes, currentAppsRes, prevAppsRes, newAgentsRes, prevAgentsRes, profilesRes] = await Promise.all([
        supabase
          .from("agents")
          .select("id, license_status, is_deactivated, onboarding_stage, evaluated_at, created_at, user_id")
          .eq("is_deactivated", false),
        // ALL hired unlicensed applications (for total unlicensed card)
        supabase
          .from("applications")
          .select("id, email, license_status, status")
          .is("terminated_at", null)
          .in("status", ["reviewing", "contracting", "approved"])
          .neq("license_status", "licensed"),
        // Period apps
        supabase
          .from("applications")
          .select("id, created_at, status, license_status")
          .is("terminated_at", null)
          .gte("created_at", currentStart),
        supabase
          .from("applications")
          .select("id, created_at, status")
          .is("terminated_at", null)
          .gte("created_at", prevStart)
          .lt("created_at", prevEnd),
        supabase
          .from("agents")
          .select("id, created_at")
          .eq("is_deactivated", false)
          .gte("created_at", currentStart),
        supabase
          .from("agents")
          .select("id, created_at")
          .eq("is_deactivated", false)
          .gte("created_at", prevStart)
          .lt("created_at", prevEnd),
        // Get profile emails for agents to deduplicate (keyed by user_id)
        supabase
          .from("profiles")
          .select("user_id, email"),
      ]);

      const agents = agentsRes.data || [];
      const allUnlicensedApps = allUnlicensedAppsRes.data || [];
      const currentApps = currentAppsRes.data || [];
      const prevApps = prevAppsRes.data || [];
      const newAgentsCurrent = newAgentsRes.data || [];
      const newAgentsPrev = prevAgentsRes.data || [];
      const profiles = profilesRes.data || [];

      // Build profile email lookup by user_id (correct field — profile_id is often null)
      const profileEmailMap = new Map<string, string>();
      profiles.forEach((p) => {
        if (p.email && p.user_id) profileEmailMap.set(p.user_id, p.email.toLowerCase().trim());
      });

      // Licensed producers (total active)
      const licensedProducers = agents.filter(
        (a) => a.license_status === "licensed"
      ).length;

      // --- Unlicensed Total: merge agents + applications, dedup by email ---
      const unlicensedEmails = new Set<string>();

      // Add unlicensed agents (lookup by user_id → profile email)
      agents.forEach((a) => {
        if (a.license_status !== "licensed") {
          if (a.user_id) {
            const email = profileEmailMap.get(a.user_id);
            if (email) unlicensedEmails.add(email);
            else unlicensedEmails.add(`agent-${a.id}`);
          } else {
            unlicensedEmails.add(`agent-${a.id}`);
          }
        }
      });

      // Add unlicensed applications (dedup against agent emails)
      allUnlicensedApps.forEach((app) => {
        const email = (app.email || "").toLowerCase().trim();
        if (email) unlicensedEmails.add(email);
        else unlicensedEmails.add(`app-${app.id}`);
      });

      const totalUnlicensed = unlicensedEmails.size;

      // New hires for period
      const newHires = Math.max(currentApps.length, newAgentsCurrent.length);
      const licensedHires = currentApps.filter(a => a.status !== "rejected" && (a as any).license_status === "licensed").length;
      const unlicensedHires = currentApps.filter(a => a.status !== "rejected" && (a as any).license_status !== "licensed").length;
      const prevHires = Math.max(prevApps.length, newAgentsPrev.length);

      // In pipeline
      const pipelineStages = ["onboarding", "in_field_training", "training_online"];
      const inPipeline = agents.filter(
        (a) =>
          a.onboarding_stage &&
          pipelineStages.includes(a.onboarding_stage) &&
          !a.evaluated_at
      ).length;

      // Growth %
      let growthPercent = 0;
      if (prevHires > 0) {
        growthPercent = Math.round(((newHires - prevHires) / prevHires) * 100);
      } else if (newHires > 0) {
        growthPercent = 100;
      }

      // Avg days to licensed
      const licensedAgents = agents.filter(
        (a) => a.license_status === "licensed" && a.created_at
      );
      let avgDaysToLicensed: number | null = null;
      if (licensedAgents.length > 0) {
        const now = new Date();
        const totalDays = licensedAgents.reduce((sum, a) => {
          const created = new Date(a.created_at);
          return sum + (now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24);
        }, 0);
        avgDaysToLicensed = Math.round(totalDays / licensedAgents.length);
      }

      setStats({
        licensedProducers,
        totalUnlicensed,
        newHires,
        licensedHires,
        unlicensedHires,
        inPipeline,
        growthPercent,
        avgDaysToLicensed,
      });
    } catch (err) {
      console.error("AgencyGrowthCard error:", err);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  // Realtime updates
  const debouncedRefetch = useDebouncedRefetch(() => fetchStats(true), 500);

  useEffect(() => {
    const channel = supabase
      .channel("agency-growth-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "agents" }, () => debouncedRefetch())
      .on("postgres_changes", { event: "*", schema: "public", table: "applications" }, () => debouncedRefetch())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [debouncedRefetch]);

  const periodLabel = period === "day" ? "Today" : period === "week" ? "This Week" : "This Month";

  const statCards = [
    {
      label: "Licensed Producers",
      value: stats?.licensedProducers ?? 0,
      icon: UserCheck,
      color: "from-emerald-500/20 to-emerald-500/5 border-emerald-500/20",
      iconColor: "text-emerald-400",
    },
    {
      label: "Unlicensed (Total)",
      value: stats?.totalUnlicensed ?? 0,
      subtitle: "Merged agents + applications",
      icon: Users,
      color: "from-orange-500/20 to-orange-500/5 border-orange-500/20",
      iconColor: "text-orange-400",
    },
    {
      label: "In Pipeline",
      value: stats?.inPipeline ?? 0,
      icon: Clock,
      color: "from-amber-500/20 to-amber-500/5 border-amber-500/20",
      iconColor: "text-amber-400",
    },
    {
      label: `New Hires ${periodLabel}`,
      value: stats?.newHires ?? 0,
      subtitle: `${stats?.licensedHires ?? 0} Licensed / ${stats?.unlicensedHires ?? 0} Unlicensed`,
      icon: TrendingUp,
      color: "from-blue-500/20 to-blue-500/5 border-blue-500/20",
      iconColor: "text-blue-400",
    },
  ];

  if (loading) {
    return (
      <GlassCard className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-muted rounded w-48" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-24 bg-muted rounded-xl" />
            ))}
          </div>
        </div>
      </GlassCard>
    );
  }

  return (
    <GlassCard className="p-6 relative overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center h-10 w-10 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20">
            <Building2 className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h3 className="font-bold text-lg">Recruiting Stats</h3>
            <p className="text-xs text-muted-foreground">Hiring & growth metrics</p>
          </div>
        </div>

        {/* Period Toggle */}
        <div className="flex items-center gap-1 bg-muted/50 rounded-lg p-0.5">
          {(["day", "week", "month"] as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={cn(
                "px-3 py-1 text-xs font-medium rounded-md transition-all",
                period === p
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {p === "day" ? "Day" : p === "week" ? "Week" : "Month"}
            </button>
          ))}
        </div>
      </div>

      {/* Stat Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        {statCards.map((stat, index) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.08 }}
            className={cn(
              "relative overflow-hidden rounded-xl border bg-gradient-to-br p-4 text-center",
              stat.color
            )}
          >
            <div className={cn("mx-auto mb-2 h-8 w-8 rounded-lg bg-background/50 flex items-center justify-center", stat.iconColor)}>
              <stat.icon className="h-4 w-4" />
            </div>
            <p className="text-2xl font-bold text-foreground">{stat.value}</p>
            <p className="text-[10px] text-muted-foreground mt-1 leading-tight">{stat.label}</p>
            {"subtitle" in stat && stat.subtitle && (
              <p className="text-[9px] text-muted-foreground/70 mt-0.5 leading-tight">{stat.subtitle}</p>
            )}
            <div className="absolute -right-4 -top-4 h-12 w-12 rounded-full bg-current opacity-10 blur-xl" />
          </motion.div>
        ))}
      </div>

      {/* Footer */}
      {stats?.avgDaysToLicensed !== null && (
        <div className="flex items-center justify-center gap-2 pt-3 border-t border-border/50 text-sm">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground">Avg Tenure:</span>
          <span className="font-semibold">{stats?.avgDaysToLicensed} days</span>
        </div>
      )}

      {/* Background decoration */}
      <div className="absolute -right-8 -bottom-8 h-32 w-32 rounded-full bg-gradient-to-br from-primary/10 to-transparent blur-2xl" />
    </GlassCard>
  );
}
