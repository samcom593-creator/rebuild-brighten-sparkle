import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  CalendarDays,
  CheckCircle2,
  ClipboardCopy,
  Coffee,
  FileText,
  Sparkles,
  Target,
  TrendingUp,
  Trophy,
  UserCheck,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { DataFreshnessBanner } from "@/components/dashboard/DataFreshnessBanner";
import { PageHeader } from "@/components/ui/page-header";
import { NextStepStuckPool } from "@/components/next-step/NextStepStuckPool";
import {
  countDistinctAgents,
  countDistinctBusinessDays,
  getCloseRate,
  getMetricBounds,
  getPriorWeekMatchedBounds,
  projectMonthEndAlp,
  sumAnnualPremium,
} from "@/lib/metricTruth";

function fmt$(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${Math.round(n).toLocaleString()}`;
}

interface TopAgent {
  name: string;
  alp: number;
}

export default function Today() {
  const { isAdmin, user } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ["today-truth-dashboard"],
    queryFn: async () => {
      const dayBounds = getMetricBounds("day");
      const weekBounds = getMetricBounds("week");
      const monthBounds = getMetricBounds("month");
      const priorWeekBounds = getPriorWeekMatchedBounds();

      const [
        todayDealsRes,
        weekDealsRes,
        monthDealsRes,
        priorWeekDealsRes,
        pipelineRes,
        uncontactedRes,
        licensedRes,
        contractedWeekRes,
        presentationsRes,
        agentRes,
      ] = await Promise.all([
        supabase
          .from("deals")
          .select("agent_id, annual_premium")
          .gte("posted_at", dayBounds.startIso)
          .lt("posted_at", dayBounds.endIso)
          .in("status", ["submitted", "active"]),
        supabase
          .from("deals")
          .select("agent_id, annual_premium")
          .gte("posted_at", weekBounds.startIso)
          .lt("posted_at", weekBounds.endIso)
          .in("status", ["submitted", "active"]),
        supabase
          .from("deals")
          .select("annual_premium, posted_at")
          .gte("posted_at", monthBounds.startIso)
          .lt("posted_at", monthBounds.endIso)
          .in("status", ["submitted", "active"]),
        supabase
          .from("deals")
          .select("annual_premium")
          .gte("posted_at", priorWeekBounds.startIso)
          .lt("posted_at", priorWeekBounds.endIso)
          .in("status", ["submitted", "active"]),
        supabase
          .from("applications")
          .select("id", { count: "exact", head: true })
          .is("terminated_at", null)
          .is("closed_at", null),
        supabase
          .from("applications")
          .select("id", { count: "exact", head: true })
          .is("terminated_at", null)
          .is("contacted_at", null),
        supabase
          .from("applications")
          .select("id", { count: "exact", head: true })
          .is("terminated_at", null)
          .eq("license_status", "licensed"),
        supabase
          .from("applications")
          .select("id", { count: "exact", head: true })
          .gte("contracted_at", weekBounds.startIso)
          .lt("contracted_at", weekBounds.endIso)
          .is("terminated_at", null),
        supabase
          .from("daily_production")
          .select("presentations")
          .gte("production_date", weekBounds.startIso.slice(0, 10))
          .lte("production_date", weekBounds.endIso.slice(0, 10)),
        supabase
          .from("agents")
          .select("id, profile:profiles(full_name)")
          .eq("is_deactivated", false)
          .eq("is_inactive", false)
          .eq("status", "active"),
      ]);

      const todayDeals = (todayDealsRes.data ?? []) as Array<{ agent_id?: string | null; annual_premium?: number | null }>;
      const weekDeals = (weekDealsRes.data ?? []) as Array<{ agent_id?: string | null; annual_premium?: number | null }>;
      const monthDeals = (monthDealsRes.data ?? []) as Array<{ agent_id?: string | null; annual_premium?: number | null; posted_at?: string | null }>;
      const priorWeekDeals = (priorWeekDealsRes.data ?? []) as Array<{ annual_premium?: number | null }>;
      const presentations = (presentationsRes.data ?? []).reduce((sum, row: { presentations?: number | null }) => sum + Number(row.presentations ?? 0), 0);

      const nameById: Record<string, string> = {};
      for (const agent of (agentRes.data ?? []) as any[]) {
        nameById[agent.id] = agent.profile?.full_name ?? "Agent";
      }

      const weeklyAgentTotals: Record<string, number> = {};
      weekDeals.forEach((deal) => {
        if (!deal.agent_id) return;
        weeklyAgentTotals[deal.agent_id] = (weeklyAgentTotals[deal.agent_id] || 0) + Number(deal.annual_premium ?? 0);
      });

      const top5 = Object.entries(weeklyAgentTotals)
        .map(([id, alp]) => ({ name: nameById[id] ?? "Agent", alp }))
        .sort((a, b) => b.alp - a.alp)
        .slice(0, 5);

      const todayAlp = sumAnnualPremium(todayDeals);
      const weekAlp = sumAnnualPremium(weekDeals);
      const monthAlp = sumAnnualPremium(monthDeals);
      const priorWeekAlp = sumAnnualPremium(priorWeekDeals);
      const weekDelta = priorWeekAlp > 0 ? ((weekAlp - priorWeekAlp) / priorWeekAlp) * 100 : (weekAlp > 0 ? 100 : 0);
      const projection = projectMonthEndAlp(monthAlp, countDistinctBusinessDays(monthDeals));

      return {
        todayAlp,
        todayDeals: todayDeals.length,
        weekAlp,
        weekDeals: weekDeals.length,
        monthAlp,
        monthDeals: monthDeals.length,
        priorWeekAlp,
        weekDelta,
        projection,
        pipeline: pipelineRes.count || 0,
        uncontacted: uncontactedRes.count || 0,
        licensed: licensedRes.count || 0,
        contractedWeek: contractedWeekRes.count || 0,
        liveProducers: countDistinctAgents(todayDeals),
        activeAgents: (agentRes.data ?? []).length,
        closeRate: getCloseRate(weekDeals.length, presentations),
        top5,
      };
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  const huddleMessage = useMemo(() => {
    if (!data) return "";
    const topLine = data.top5[0]
      ? `Top producer this week: ${data.top5[0].name} at ${fmt$(data.top5[0].alp)}.`
      : "No posted deals yet this week.";
    return [
      `APEX Today · ${format(new Date(), "EEEE, MMMM d")}`,
      `Today's ALP: ${fmt$(data.todayAlp)} from ${data.todayDeals} deals.`,
      `Week-to-date ALP: ${fmt$(data.weekAlp)} (${data.weekDeals} deals, ${data.closeRate}% close rate).`,
      `Pipeline: ${data.pipeline} open · ${data.uncontacted} untouched · ${data.contractedWeek} contracted this week.`,
      `Month pace: ${fmt$(data.projection.projection)} projected from ${fmt$(data.monthAlp)} MTD.`,
      topLine,
    ].join("\n");
  }, [data]);

  if (isLoading || !data) {
    return (
      <div className="mx-auto max-w-6xl p-6">
        <div className="h-32 animate-pulse rounded-xl bg-muted/30" />
      </div>
    );
  }

  const nextActions = [
    `${data.uncontacted} applications still need first contact.`,
    `${data.licensed} licensed applicants are ready for fast follow-up.`,
    `${data.contractedWeek} people have already contracted this week.`,
    data.top5[0]
      ? `Shout out ${data.top5[0].name} for leading this week at ${fmt$(data.top5[0].alp)}.`
      : "Open the board with the first posted deal.",
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 md:p-6">
      <PageHeader
        accent="primary"
        eyebrow="Daily Pulse"
        eyebrowIcon={<Sparkles className="h-3 w-3" />}
        title="Today"
        subtitle={format(new Date(), "EEEE · MMMM d, yyyy")}
      />

      <DataFreshnessBanner autoRepair />

      {/* NextStep stuck pool — admin sees all; managers see their downline */}
      <NextStepStuckPool
        limit={6}
        ownerUserId={isAdmin ? null : user?.id ?? null}
        heading={isAdmin ? "Pipeline drift today" : "Your downline · drift today"}
      />

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <GlassCard className="p-4">
          <div className="mb-1 flex items-center gap-2"><CalendarDays className="h-4 w-4 text-primary" /><span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Actuals</span></div>
          <div className="text-3xl font-bold text-primary">{fmt$(data.todayAlp)}</div>
          <p className="text-sm text-muted-foreground">{data.todayDeals} deals today · {data.liveProducers} live producers</p>
        </GlassCard>
        <GlassCard className="p-4">
          <div className="mb-1 flex items-center gap-2"><Trophy className="h-4 w-4 text-amber-400" /><span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Week To Date</span></div>
          <div className="text-3xl font-bold text-amber-300">{fmt$(data.weekAlp)}</div>
          <p className="text-sm text-muted-foreground">{data.weekDeals} deals · {data.closeRate}% close rate</p>
        </GlassCard>
        <GlassCard className="p-4">
          <div className="mb-1 flex items-center gap-2"><Target className="h-4 w-4 text-emerald-400" /><span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Month Pace</span></div>
          <div className="text-3xl font-bold text-emerald-300">{fmt$(data.projection.projection)}</div>
          <p className="text-sm text-muted-foreground">MTD {fmt$(data.monthAlp)} · {data.projection.confidence} confidence</p>
        </GlassCard>
        <GlassCard className="p-4">
          <div className="mb-1 flex items-center gap-2"><Users className="h-4 w-4 text-violet-400" /><span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Pipeline</span></div>
          <div className="text-3xl font-bold text-violet-300">{data.pipeline}</div>
          <p className="text-sm text-muted-foreground">{data.uncontacted} untouched · {data.licensed} licensed</p>
        </GlassCard>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <GlassCard className="p-5">
          <div className="mb-3 flex items-center gap-2"><TrendingUp className="h-5 w-5 text-primary" /><h2 className="text-lg font-bold">Actuals</h2></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-border/40 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Agency Production</p>
              <p className="mt-1 text-2xl font-bold">{fmt$(data.weekAlp)}</p>
              <p className="text-sm text-muted-foreground">{data.activeAgents} active agents</p>
            </div>
            <div className="rounded-xl border border-border/40 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Applications This Week</p>
              <p className="mt-1 text-2xl font-bold">{data.pipeline}</p>
              <p className="text-sm text-muted-foreground">{data.uncontacted} uncontacted</p>
            </div>
          </div>
        </GlassCard>

        <GlassCard className="p-5">
          <div className="mb-3 flex items-center gap-2"><Target className="h-5 w-5 text-amber-400" /><h2 className="text-lg font-bold">Pace & Projection</h2></div>
          <ul className="space-y-2 text-sm">
            <li className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-400" /><span>{fmt$(data.monthAlp)} calendar MTD from {data.monthDeals} deals.</span></li>
            <li className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-400" /><span>{fmt$(data.projection.projection)} projected month-end ALP if this pace holds.</span></li>
            <li className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-400" /><span>Projection confidence is {data.projection.confidence} based on {data.projection.activeDays} posted-sales day{data.projection.activeDays === 1 ? "" : "s"}.</span></li>
          </ul>
        </GlassCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <GlassCard className="p-5">
          <div className="mb-3 flex items-center gap-2"><Target className="h-5 w-5 text-violet-400" /><h2 className="text-lg font-bold">Prior Week Comparison</h2></div>
          <div className="rounded-xl border border-border/40 p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Matched weekdays</p>
            <p className="mt-1 text-2xl font-bold">{data.weekDelta >= 0 ? "+" : ""}{data.weekDelta.toFixed(0)}%</p>
            <p className="text-sm text-muted-foreground">{fmt$(data.weekAlp)} this week vs {fmt$(data.priorWeekAlp)} over the same weekdays last week.</p>
          </div>
        </GlassCard>

        <GlassCard className="p-5">
          <div className="mb-3 flex items-center gap-2"><Coffee className="h-5 w-5 text-primary" /><h2 className="text-lg font-bold">Next Actions</h2></div>
          <ul className="space-y-2">
            {nextActions.map((note) => (
              <li key={note} className="flex items-start gap-2 text-sm">
                <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-400" />
                <span>{note}</span>
              </li>
            ))}
          </ul>
        </GlassCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <GlassCard className="p-5">
          <div className="mb-3 flex items-center gap-2"><Trophy className="h-5 w-5 text-amber-400" /><h2 className="text-lg font-bold">Top Producers This Week</h2></div>
          {data.top5.length === 0 ? (
            <p className="text-sm text-muted-foreground">No posted deals yet this week.</p>
          ) : (
            <div className="space-y-2">
              {data.top5.map((agent: TopAgent, index) => (
                <div key={`${agent.name}-${index}`} className="flex items-center justify-between rounded-lg bg-muted/20 px-3 py-2">
                  <span className="font-medium">{index + 1}. {agent.name}</span>
                  <span className="font-bold text-amber-300">{fmt$(agent.alp)}</span>
                </div>
              ))}
            </div>
          )}
        </GlassCard>

        <GlassCard className="p-5">
          <div className="mb-3 flex items-center gap-2"><FileText className="h-5 w-5 text-primary" /><h2 className="text-lg font-bold">Shareable Huddle</h2></div>
          <pre className="whitespace-pre-wrap rounded-lg bg-muted/20 p-3 text-sm text-muted-foreground">{huddleMessage}</pre>
          {isAdmin && (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={async () => {
                  await navigator.clipboard.writeText(huddleMessage);
                  toast.success("Copied huddle summary");
                }}
              >
                <ClipboardCopy className="mr-2 h-4 w-4" />
                Copy update
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  const { error } = await supabase.functions.invoke("morning-brief", { body: {} });
                  if (error) {
                    toast.error(error.message);
                    return;
                  }
                  toast.success("Morning brief sent");
                }}
              >
                Send to Discord
              </Button>
            </div>
          )}
        </GlassCard>
      </div>
    </div>
  );
}
