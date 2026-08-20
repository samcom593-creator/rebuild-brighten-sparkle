import { useQuery } from "@tanstack/react-query";
import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarDays,
  FileText,
  GraduationCap,
  Target,
  TrendingUp,
  Trophy,
  UserCheck,
  Users,
} from "lucide-react";
import { StatCard } from "@/components/dashboard/StatCard";
import { supabase } from "@/integrations/supabase/client";
import { getBusinessDayBounds, getBusinessMonthBounds, getBusinessWeekBounds, getMatchedPriorWeekBounds } from "@/lib/dateUtils";
import {
  LIVE_AGENT_DEAL_WINDOW_DAYS,
  METRIC_REGISTRY,
  countDistinctAgents,
  countDistinctBusinessDays,
  formatMetricSource,
  getCloseRate,
  getLiveAgentCutoffIso,
  projectMonthEndAlp,
  sumAnnualPremium,
} from "@/lib/metricTruth";
import { DEAL_TRUTH_STATUS_FILTER, dealTruthWindowOr, liveDealWindowOr } from "@/lib/dealTruth";
import { APPLICATION_RECORD_TYPE } from "@/shared/api/applicationRecordType";

interface Props {
  agentId?: string;
  title?: string;
}

function fmtMoney(amount: number): string {
  return `$${Math.round(amount).toLocaleString()}`;
}

export function ExtendedStatsStrip({ agentId, title = "More numbers" }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ["extended-stats-strip-truth", agentId ?? "agency"],
    queryFn: async () => {
      const dayBounds = getBusinessDayBounds();
      const weekBounds = getBusinessWeekBounds();
      const monthBounds = getBusinessMonthBounds();
      const priorWeekBounds = getMatchedPriorWeekBounds();

      // Type-erase to any inside the helper. Supabase's chained-builder types
      // explode through a generic helper and trip TS2589 "instantiation
      // excessively deep". Behavior is unchanged.
      const applyAgentFilter = <T,>(query: T): T =>
        (agentId ? (query as any).eq("agent_id", agentId) : query) as T;

      const [todayRes, weekRes, priorWeekRes, monthRes, syncRes] = await Promise.all([
        applyAgentFilter(
          supabase
            .from("deals")
            .select("annual_premium, agent_id, posted_at, created_at")
            .or(dealTruthWindowOr(dayBounds.startIso, dayBounds.endIso))
            .in("status", DEAL_TRUTH_STATUS_FILTER),
        ),
        applyAgentFilter(
          supabase
            .from("deals")
            .select("annual_premium, posted_at, created_at")
            .or(dealTruthWindowOr(weekBounds.startIso, weekBounds.endIso))
            .in("status", DEAL_TRUTH_STATUS_FILTER),
        ),
        applyAgentFilter(
          supabase
            .from("deals")
            .select("annual_premium, posted_at, created_at")
            .or(dealTruthWindowOr(priorWeekBounds.startIso, priorWeekBounds.endIso))
            .in("status", DEAL_TRUTH_STATUS_FILTER),
        ),
        applyAgentFilter(
          supabase
            .from("deals")
            .select("annual_premium, posted_at, created_at")
            .or(dealTruthWindowOr(monthBounds.startIso, monthBounds.endIso))
            .in("status", DEAL_TRUTH_STATUS_FILTER),
        ),
        supabase
          .from("agentlink_sync_log" as any)
          .select("finished_at, started_at")
          .eq("status", "ok")
          .order("started_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      const todayRows = (todayRes.data ?? []) as Array<{ annual_premium?: number | null; agent_id?: string | null; posted_at?: string | null }>;
      const weekRows = (weekRes.data ?? []) as Array<{ annual_premium?: number | null; posted_at?: string | null }>;
      const priorWeekRows = (priorWeekRes.data ?? []) as Array<{ annual_premium?: number | null }>;
      const monthRows = (monthRes.data ?? []) as Array<{ annual_premium?: number | null; posted_at?: string | null }>;
      const syncRow = syncRes.data as { finished_at?: string | null; started_at?: string | null } | null;

      const todayALP = sumAnnualPremium(todayRows);
      const todayDeals = todayRows.length;
      const weekALP = sumAnnualPremium(weekRows);
      const priorWeekALP = sumAnnualPremium(priorWeekRows);
      const monthALP = sumAnnualPremium(monthRows);
      const avgPerDeal = monthRows.length > 0 ? monthALP / monthRows.length : 0;
      const biggestToday = todayRows.reduce((max, row) => Math.max(max, Number(row.annual_premium ?? 0)), 0);
      const projection = projectMonthEndAlp(monthALP, countDistinctBusinessDays(monthRows));
      const weekDelta = priorWeekALP > 0 ? ((weekALP - priorWeekALP) / priorWeekALP) * 100 : (weekALP > 0 ? 100 : 0);

      let team: {
        activeAgents: number;
        producedToday: number;
        pipelineApps: number;
        licensedCount: number;
        contractedCount: number;
        presentations: number;
        closeRate: number;
      } | null = null;

      if (!agentId) {
        const liveCutoffIso = getLiveAgentCutoffIso();
        const [activeDealsRes, pipelineRes, licensedRes, contractedRes, presentationsRes] = await Promise.all([
          supabase
            .from("deals")
            .select("agent_id, posted_at, created_at")
            .or(liveDealWindowOr(liveCutoffIso))
            .in("status", DEAL_TRUTH_STATUS_FILTER),
          supabase
            .from("applications")
            .select("id", { count: "exact", head: true }).eq("record_type", APPLICATION_RECORD_TYPE)
            .is("terminated_at", null)
            .is("closed_at", null),
          supabase
            .from("applications")
            .select("id", { count: "exact", head: true }).eq("record_type", APPLICATION_RECORD_TYPE)
            .is("terminated_at", null)
            .eq("license_status", "licensed"),
          supabase
            .from("applications")
            .select("id", { count: "exact", head: true }).eq("record_type", APPLICATION_RECORD_TYPE)
            .is("terminated_at", null)
            .not("contracted_at", "is", null),
          supabase
            .from("daily_production")
            .select("presentations")
            .gte("production_date", weekBounds.startIso.slice(0, 10))
            .lte("production_date", weekBounds.endIso.slice(0, 10)),
        ]);

        const activeSet = new Set<string>();
        (activeDealsRes.data ?? []).forEach((row: any) => row.agent_id && activeSet.add(row.agent_id));
        const presentations = (presentationsRes.data ?? []).reduce((sum, row: { presentations?: number | null }) => sum + Number(row.presentations ?? 0), 0);

        team = {
          activeAgents: activeSet.size,
          producedToday: countDistinctAgents(todayRows),
          pipelineApps: pipelineRes.count || 0,
          licensedCount: licensedRes.count || 0,
          contractedCount: contractedRes.count || 0,
          presentations,
          closeRate: getCloseRate(weekRows.length, presentations),
        };
      }

      return {
        todayALP,
        todayDeals,
        weekALP,
        priorWeekALP,
        weekDelta,
        monthALP,
        avgPerDeal,
        biggestToday,
        projection,
        team,
        lastUpdatedAt: syncRow?.finished_at || syncRow?.started_at || null,
      };
    },
    staleTime: 60_000,
    refetchInterval: 300_000,
  });

  if (isLoading || !data) return null;

  const sourceHint = formatMetricSource(METRIC_REGISTRY.dealsToday, data.lastUpdatedAt);

  return (
    <section className="mb-6 space-y-3">
      <div className="flex items-center gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">{title}</p>
        <div className="h-px flex-1 bg-border/30" />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
        <StatCard
          title="Today's ALP"
          value={fmtMoney(data.todayALP)}
          icon={CalendarDays}
          variant="primary"
          hint={`${data.todayDeals} deals · ${sourceHint}`}
        />
        <StatCard
          title="Month-end Projection"
          value={fmtMoney(data.projection.projection)}
          icon={Target}
          variant="success"
          hint={
            data.projection.activeDays < 3
              ? `MTD ${fmtMoney(data.monthALP)} · waiting on more posted sales days`
              : `MTD ${fmtMoney(data.monthALP)} · ${data.projection.confidence} confidence`
          }
        />
        <StatCard
          title="Average ALP Per Deal"
          value={fmtMoney(data.avgPerDeal)}
          icon={TrendingUp}
          variant="default"
          hint={data.biggestToday > 0 ? `Biggest today: ${fmtMoney(data.biggestToday)}` : "No deals posted yet today"}
        />
        <StatCard
          title="Week Prior"
          value={`${data.weekDelta >= 0 ? "+" : ""}${data.weekDelta.toFixed(0)}%`}
          icon={data.weekDelta >= 0 ? ArrowUpRight : ArrowDownRight}
          variant={data.weekDelta >= 0 ? "success" : "warning"}
          hint={`${fmtMoney(data.weekALP)} now vs ${fmtMoney(data.priorWeekALP)} same weekdays last week`}
        />

        {data.team && (
          <>
            <StatCard
              title="Agency Production"
              value={fmtMoney(data.weekALP)}
              icon={Trophy}
              variant="success"
              hint={`${data.team.closeRate}% close rate · WTD`}
            />
            <StatCard
              title="Live Agents"
              value={data.team.activeAgents}
              icon={Users}
              hint={`${data.team.producedToday} produced today · ${LIVE_AGENT_DEAL_WINDOW_DAYS}d window`}
            />
            <StatCard
              title="Pipeline Applications"
              value={data.team.pipelineApps}
              icon={FileText}
              hint={`${data.team.licensedCount} licensed · ${data.team.contractedCount} contracted`}
            />
            <StatCard
              title="Presentations This Week"
              value={data.team.presentations}
              icon={UserCheck}
              hint={`${data.team.closeRate}% close rate`}
            />
          </>
        )}

        {agentId && (
          <>
            <StatCard
              title="This Week's ALP"
              value={fmtMoney(data.weekALP)}
              icon={Trophy}
              variant="success"
              hint={`${fmtMoney(data.priorWeekALP)} same weekdays last week`}
            />
            <StatCard
              title="Calendar MTD"
              value={fmtMoney(data.monthALP)}
              icon={GraduationCap}
              hint={`${data.projection.activeDays} active sales day${data.projection.activeDays === 1 ? "" : "s"} this month`}
            />
          </>
        )}
      </div>
    </section>
  );
}
