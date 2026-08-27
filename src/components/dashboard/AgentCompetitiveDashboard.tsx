import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { format, startOfWeek, endOfWeek } from "date-fns";
import { getBusinessWeekBounds } from "@/lib/dateUtils";
import { Trophy, TrendingUp, Target, Crown, Medal, Users, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  resolveAgentNames,
  AGENT_NAME_FALLBACK,
  type AgentNameSource,
} from "@/shared/api/agentDisplayNames";
import { GlassCard } from "@/components/ui/glass-card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { DEAL_TRUTH_STATUS_FILTER } from "@/lib/dealTruth";
import { useProductionRealtime } from "@/hooks/useProductionRealtime";
import { APPLICATION_RECORD_TYPE } from "@/shared/api/applicationRecordType";

interface Props {
  agentId: string;
  weeklyTarget?: number;
}

interface LbEntry {
  agent_id: string;
  full_name: string;
  weekly_aop: number;
}

interface Snapshot {
  weeklyALP: number;
  productionRank: number | null;
  productionTotal: number;
  recruitRank: number | null;
  recruitTotal: number;
  recruitsThisWeek: number;
  topTen: LbEntry[];
}

const emptySnap: Snapshot = {
  weeklyALP: 0,
  productionRank: null,
  productionTotal: 0,
  recruitRank: null,
  recruitTotal: 0,
  recruitsThisWeek: 0,
  topTen: [],
};

function fmt$(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${Math.round(n).toLocaleString()}`;
}

function rankSuffix(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function AgentCompetitiveDashboard({ agentId, weeklyTarget = 10000 }: Props) {
  const [snap, setSnap] = useState<Snapshot>(emptySnap);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const weekBounds = getBusinessWeekBounds();

      // ── Weekly production for all active agents ──
      const { data: agents } = await supabase
        .from("agents")
        .select("id, user_id, display_name")
        .eq("is_deactivated", false)
        .eq("is_inactive", false);

      const agentIds = (agents ?? []).map(a => a.id);
      const nameByAgent = await resolveAgentNames((agents ?? []) as AgentNameSource[]);

      // Weekly ALP uses posted_at so the agent portal, dashboard, and
      // leaderboards all read the same truth layer.
      const { data: prod } = await supabase
        .from("deals")
        .select("agent_id, annual_premium")
        .gte("posted_at", weekBounds.startIso)
        .lt("posted_at", weekBounds.endIso)
        .in("status", DEAL_TRUTH_STATUS_FILTER)
        .in("agent_id", agentIds.length ? agentIds : ["00000000-0000-0000-0000-000000000000"]);

      const alpMap: Record<string, number> = {};
      for (const r of (prod ?? []) as Array<{ agent_id: string; annual_premium: number | null }>) {
        alpMap[r.agent_id] = (alpMap[r.agent_id] ?? 0) + Number(r.annual_premium ?? 0);
      }

      const lb = agentIds
        .map(id => ({
          agent_id: id,
          full_name: nameByAgent.get(id)?.name ?? AGENT_NAME_FALLBACK,
          weekly_aop: alpMap[id] ?? 0,
        }))
        .sort((a, b) => b.weekly_aop - a.weekly_aop);

      const myProdIdx = lb.findIndex(x => x.agent_id === agentId && x.weekly_aop > 0);
      const productionRank = myProdIdx >= 0 ? myProdIdx + 1 : null;
      const weeklyALP = alpMap[agentId] ?? 0;

      // ── Recruiting rank (applications referred this week) ──
      const { data: recruits } = await supabase
        .from("applications")
        .select("referral_manager_id").eq("record_type", APPLICATION_RECORD_TYPE)
        .gte("created_at", weekBounds.startIso)
        .lt("created_at", weekBounds.endIso)
        .not("referral_manager_id", "is", null);

      const recruitMap: Record<string, number> = {};
      for (const r of (recruits ?? []) as Array<{ referral_manager_id: string }>) {
        recruitMap[r.referral_manager_id] = (recruitMap[r.referral_manager_id] ?? 0) + 1;
      }
      const recruitLb = Object.entries(recruitMap)
        .map(([id, count]) => ({ id, count }))
        .sort((a, b) => b.count - a.count);
      const myRecruitIdx = recruitLb.findIndex(r => r.id === agentId);
      const recruitRank = myRecruitIdx >= 0 ? myRecruitIdx + 1 : null;
      const recruitsThisWeek = recruitMap[agentId] ?? 0;

      setSnap({
        weeklyALP,
        productionRank,
        productionTotal: lb.filter(x => x.weekly_aop > 0).length,
        recruitRank,
        recruitTotal: recruitLb.length,
        recruitsThisWeek,
        topTen: lb.slice(0, 10),
      });
    } catch (e) {
      console.error("competitive dashboard load:", e);
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => { load(); }, [load]);
  useProductionRealtime(load, 500);

  if (loading) {
    return (
      <GlassCard className="p-6 animate-pulse">
        <div className="h-4 w-40 bg-muted/40 rounded mb-4" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {/* stable-key-allow:skeleton */}
          {[0,1,2,3].map(i => <div key={i} className="h-20 bg-muted/20 rounded-md" />)}
        </div>
      </GlassCard>
    );
  }

  const pctToTarget = Math.min(100, Math.round((snap.weeklyALP / weeklyTarget) * 100));
  const gap = Math.max(0, weeklyTarget - snap.weeklyALP);

  return (
    <GlassCard className="p-4 md:p-6 relative overflow-hidden">
      <div className="absolute inset-0 bg-white dark:bg-card pointer-events-none" />
      <div className="relative space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg md:text-xl font-bold flex items-center gap-2">
              <Trophy className="h-5 w-5 text-amber-400" />
              Weekly Competition
            </h3>
            <p className="text-xs text-muted-foreground">
              {format(startOfWeek(new Date(), { weekStartsOn: 1 }), "MMM d")} – {format(endOfWeek(new Date(), { weekStartsOn: 1 }), "MMM d")}
            </p>
          </div>
        </div>

        {/* Headline KPI row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatTile
            icon={TrendingUp}
            label="Weekly ALP"
            value={fmt$(snap.weeklyALP)}
            tint="from-emerald-500/20 to-emerald-500/5 text-emerald-400"
          />
          <StatTile
            icon={Crown}
            label="Production Rank"
            value={snap.productionRank ? `${rankSuffix(snap.productionRank)} / ${snap.productionTotal}` : "—"}
            tint="from-amber-500/20 to-amber-500/5 text-amber-400"
          />
          <StatTile
            icon={Users}
            label="Recruit Rank"
            value={snap.recruitRank ? `${rankSuffix(snap.recruitRank)} / ${snap.recruitTotal}` : "—"}
            sub={snap.recruitsThisWeek ? `${snap.recruitsThisWeek} this week` : "No recruits yet"}
            tint="from-violet-500/20 to-violet-500/5 text-primary"
          />
          <StatTile
            icon={Target}
            label="Target Progress"
            value={`${pctToTarget}%`}
            sub={gap > 0 ? `${fmt$(gap)} to go` : "🎯 target hit"}
            tint="from-primary/20 to-primary/5 text-primary"
          />
        </div>

        {/* Target progress bar */}
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Weekly goal</span>
            <span>{fmt$(snap.weeklyALP)} / {fmt$(weeklyTarget)}</span>
          </div>
          <Progress value={pctToTarget} className="h-2" />
        </div>

        {/* Top 10 with agent highlighted */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <h4 className="text-sm font-semibold">Top 10 This Week</h4>
          </div>
          {snap.topTen.length === 0 || snap.topTen[0].weekly_aop === 0 ? (
            <p className="text-sm text-muted-foreground italic">No production logged yet this week.</p>
          ) : (
            <div className="space-y-1">
              {snap.topTen.map((e, i) => {
                const isMe = e.agent_id === agentId;
                return (
                  <motion.div
                    key={e.agent_id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.03 }}
                    className={cn(
                      "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors",
                      isMe
                        ? "bg-white dark:bg-card border border-primary/40 font-semibold"
                        : "hover:bg-muted/30",
                    )}
                  >
                    <span className="w-6 text-center">
                      {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : <span className="text-xs text-muted-foreground">{i + 1}.</span>}
                    </span>
                    <span className="flex-1 truncate">
                      {e.full_name}
                      {isMe && <span className="ml-2 text-xs text-primary">(you)</span>}
                    </span>
                    <span className={cn(
                      "tabular-nums",
                      isMe ? "text-primary" : i < 3 ? "text-amber-400" : "text-muted-foreground",
                    )}>
                      {fmt$(e.weekly_aop)}
                    </span>
                  </motion.div>
                );
              })}
              {/* Show agent's position if outside top 10 */}
              {snap.productionRank && snap.productionRank > 10 && (
                <div className="mt-2 px-3 py-2 rounded-lg bg-white dark:bg-card border border-primary/30 text-sm">
                  <span className="w-6 inline-block text-center text-xs text-muted-foreground mr-2">
                    {snap.productionRank}.
                  </span>
                  <span className="font-semibold">You — {fmt$(snap.weeklyALP)}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </GlassCard>
  );
}

function StatTile({
  icon: Icon, label, value, sub, tint,
}: {
  icon: React.ElementType; label: string; value: string; sub?: string; tint: string;
}) {
  return (
    <div className={cn(
      "rounded-md border border-border/50  p-3 transition-all hover:scale-[1.02]",
      tint,
    )}>
      <div className="flex items-center gap-2 mb-1">
        <Icon className="h-4 w-4" />
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">{label}</span>
      </div>
      <div className="text-lg md:text-xl font-bold text-foreground leading-tight">{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}
