import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { StatCard } from "@/components/dashboard/StatCard";
import {
  CalendarDays,
  TrendingUp,
  Users,
  UserCheck,
  Trophy,
  Target,
  ArrowUpRight,
  ArrowDownRight,
  GraduationCap,
  FileText,
} from "lucide-react";

interface Props {
  /** When provided, all stats are scoped to this single agent (personal view). */
  agentId?: string;
  /** Optional title above the strip. */
  title?: string;
}

function pctDelta(curr: number, prev: number): number {
  if (!prev) return curr > 0 ? 100 : 0;
  return Math.round(((curr - prev) / prev) * 1000) / 10;
}

function startOfWeek(d: Date): Date {
  const x = new Date(d);
  const day = x.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  x.setHours(0, 0, 0, 0);
  return x;
}

function isoDate(d: Date): string {
  return d.toISOString().split("T")[0];
}

/**
 * Drop-in stats strip that supplements the main dashboard with:
 * – Today's production
 * – MTD ALP + 30-day projection (pace)
 * – Team activity (active, produced today, attendance %)
 * – Recruiting funnel (pipeline, licensed, contracted)
 * – Deal quality (avg ALP/deal, biggest deal this week)
 * – Week-over-week & month-over-month deltas
 *
 * Pass `agentId` to render the personal variant (no team / no recruiting).
 */
export function ExtendedStatsStrip({ agentId, title = "More numbers" }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ["extended-stats-strip", agentId ?? "agency"],
    queryFn: async () => {
      const now = new Date();
      const today = isoDate(now);
      const wkStart = startOfWeek(now);
      const prevWkStart = new Date(wkStart);
      prevWkStart.setDate(prevWkStart.getDate() - 7);
      const prevWkEnd = new Date(wkStart);
      prevWkEnd.setDate(prevWkEnd.getDate() - 1);
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
      const dayOfMonth = now.getDate();
      const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

      // Source of truth: deals table (Agent Link sync), filtered to
      // submitted/active. daily_production was agent self-report and
      // drifted from agency totals. Sam 2026-04-27: every "today/week/
      // month" stat must agree with the rest of the dashboard.
      const VALID_STATUS = ["submitted", "active"] as const;
      const filterAgent = (q: any) => (agentId ? q.eq("agent_id", agentId) : q);

      const [todayRes, weekRes, prevWeekRes, monthRes, prevMonthRes] = await Promise.all([
        filterAgent(
          supabase
            .from("deals")
            .select("annual_premium, agent_id")
            .eq("effective_date", today)
            .in("status", VALID_STATUS as unknown as string[])
        ),
        filterAgent(
          supabase
            .from("deals")
            .select("annual_premium")
            .gte("effective_date", isoDate(wkStart))
            .in("status", VALID_STATUS as unknown as string[])
        ),
        filterAgent(
          supabase
            .from("deals")
            .select("annual_premium")
            .gte("effective_date", isoDate(prevWkStart))
            .lte("effective_date", isoDate(prevWkEnd))
            .in("status", VALID_STATUS as unknown as string[])
        ),
        filterAgent(
          supabase
            .from("deals")
            .select("annual_premium, agent_id, effective_date")
            .gte("effective_date", isoDate(monthStart))
            .in("status", VALID_STATUS as unknown as string[])
        ),
        filterAgent(
          supabase
            .from("deals")
            .select("annual_premium, effective_date")
            .gte("effective_date", isoDate(prevMonthStart))
            .lte("effective_date", isoDate(prevMonthEnd))
            .in("status", VALID_STATUS as unknown as string[])
        ),
      ]);

      const sumAP = (rows: any[] | null) =>
        (rows || []).reduce((s, r: any) => s + (Number(r.annual_premium) || 0), 0);
      const countDeals = (rows: any[] | null) => (rows || []).length;

      const todayALP = sumAP(todayRes.data as any[]);
      const todayDeals = countDeals(todayRes.data as any[]);
      const weekALP = sumAP(weekRes.data as any[]);
      const prevWeekALP = sumAP(prevWeekRes.data as any[]);
      const monthALP = sumAP(monthRes.data as any[]);
      const monthDeals = countDeals(monthRes.data as any[]);
      const prevMonthALP = sumAP(prevMonthRes.data as any[]);

      // 30-day pace projection (linear extrapolation from MTD pace)
      const projection =
        dayOfMonth > 0 ? Math.round((monthALP / dayOfMonth) * daysInMonth) : 0;

      // Deal quality
      const avgPerDeal = monthDeals > 0 ? Math.round(monthALP / monthDeals) : 0;
      const biggestThisWeek = (weekRes.data || []).reduce(
        (m: number, r: any) => Math.max(m, Number(r.annual_premium) || 0),
        0
      );

      // Deltas
      const wowDelta = pctDelta(weekALP, prevWeekALP);
      // Month-over-month: compare same window (1..dayOfMonth) of prev month
      const prevMonthSameWindow = (prevMonthRes.data || []).filter((r: any) => {
        const d = new Date(r.effective_date || prevMonthStart);
        return d.getDate() <= dayOfMonth;
      });
      const prevMonthWindowALP = sumAP(prevMonthSameWindow as any[]);
      const momDelta = pctDelta(monthALP, prevMonthWindowALP);

      // Team-only stats — skip when in agent-personal mode
      let activeAgents = 0;
      let producedToday = 0;
      let attendancePct = 0;
      let pipelineApps = 0;
      let licensedCount = 0;
      let contractedCount = 0;

      if (!agentId) {
        // "Active producers" = agents who EITHER summed >= $4k AP in the
        // last 7 days OR were promoted into live/evaluated/transfer in the
        // last 7 days. Replaces the old "status=active" agent flag, which
        // counted everyone with an active row (including non-producers).
        const sevenAgo = new Date(); sevenAgo.setDate(sevenAgo.getDate() - 7);
        const sevenStr = sevenAgo.toISOString().split("T")[0];
        const sevenISO = sevenAgo.toISOString();

        const [activeDealsRes, releasedRes, attRes, pipelineRes, licensedRes, contractedRes] = await Promise.all([
          supabase.from("deals")
            .select("agent_id, annual_premium")
            .gte("effective_date", sevenStr)
            .in("status", ["submitted", "active"]),
          supabase.from("agents")
            .select("id")
            .gte("stage_changed_at", sevenISO)
            .in("onboarding_stage", ["live", "evaluated", "transfer"]),
          supabase.from("agent_attendance").select("status").eq("attendance_date", today),
          supabase.from("applications").select("*", { count: "exact", head: true }).is("terminated_at", null),
          supabase.from("applications").select("*", { count: "exact", head: true }).is("terminated_at", null).eq("license_status", "licensed"),
          supabase.from("applications").select("*", { count: "exact", head: true }).is("terminated_at", null).not("contracted_at", "is", null),
        ]);
        const sumByAgent = new Map<string, number>();
        for (const r of (activeDealsRes.data || []) as any[]) {
          if (!r.agent_id) continue;
          sumByAgent.set(r.agent_id, (sumByAgent.get(r.agent_id) || 0) + (Number(r.annual_premium) || 0));
        }
        const activeSet = new Set<string>();
        for (const [id, ap] of sumByAgent) if (ap >= 4000) activeSet.add(id);
        for (const r of (releasedRes.data || []) as any[]) if (r.id) activeSet.add(r.id);
        activeAgents = activeSet.size;
        const distinctToday = new Set((todayRes.data || []).map((r: any) => r.agent_id).filter(Boolean));
        producedToday = distinctToday.size;
        const attendance = attRes.data || [];
        const present = attendance.filter((a: any) => a.status === "present" || a.status === "late").length;
        attendancePct = attendance.length > 0 ? Math.round((present / attendance.length) * 100) : 0;
        pipelineApps = pipelineRes.count ?? 0;
        licensedCount = licensedRes.count ?? 0;
        contractedCount = contractedRes.count ?? 0;
      }

      return {
        todayALP, todayDeals,
        monthALP, projection,
        avgPerDeal, biggestThisWeek,
        wowDelta, momDelta,
        activeAgents, producedToday, attendancePct,
        pipelineApps, licensedCount, contractedCount,
      };
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  if (isLoading || !data) return null;

  const fmtMoney = (n: number) => `$${n.toLocaleString()}`;
  const wowPositive = data.wowDelta >= 0;
  const momPositive = data.momDelta >= 0;

  return (
    <section className="space-y-3 mb-6">
      <div className="flex items-center gap-2">
        <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground font-semibold">
          {title}
        </p>
        <div className="h-px flex-1 bg-border/30" />
      </div>

      {/* Today + Pace + Deal quality + Deltas */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        <StatCard
          title="Today's ALP"
          value={fmtMoney(data.todayALP)}
          icon={CalendarDays}
          variant="primary"
          hint={`${data.todayDeals} deals today`}
        />
        <StatCard
          title="30-Day Projection"
          value={fmtMoney(data.projection)}
          icon={Target}
          variant="success"
          hint={`MTD ${fmtMoney(data.monthALP)}`}
        />
        <StatCard
          title="Avg ALP / Deal"
          value={fmtMoney(data.avgPerDeal)}
          icon={TrendingUp}
          variant="default"
          hint={`Top this week: ${fmtMoney(data.biggestThisWeek)}`}
        />
        <StatCard
          title="Week vs Prior"
          value={`${wowPositive ? "+" : ""}${data.wowDelta}%`}
          icon={wowPositive ? ArrowUpRight : ArrowDownRight}
          variant={wowPositive ? "success" : "warning"}
          hint={`MTD vs prior: ${momPositive ? "+" : ""}${data.momDelta}%`}
        />
      </div>

      {/* Team & recruiting — only in agency mode */}
      {!agentId && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard
            title="Active Agents"
            value={data.activeAgents}
            icon={Users}
            variant="default"
          />
          <StatCard
            title="Produced Today"
            value={`${data.producedToday}/${data.activeAgents}`}
            icon={Trophy}
            variant="success"
          />
          <StatCard
            title="Attendance"
            value={`${data.attendancePct}%`}
            icon={UserCheck}
            variant={data.attendancePct >= 80 ? "success" : "warning"}
          />
          <StatCard
            title="Pipeline Apps"
            value={data.pipelineApps}
            icon={FileText}
            variant="primary"
          />
          <StatCard
            title="Licensed"
            value={data.licensedCount}
            icon={GraduationCap}
            variant="success"
          />
          <StatCard
            title="Contracted"
            value={data.contractedCount}
            icon={UserCheck}
            variant="default"
          />
        </div>
      )}
    </section>
  );
}