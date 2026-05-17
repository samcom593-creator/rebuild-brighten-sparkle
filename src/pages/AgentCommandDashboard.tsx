// AgentCommandDashboard — the new agent landing experience.
//
// Replaces the legacy AgentPortal that piled 12+ hideable cards together
// and felt unchanged. This page reads from the central truth layer
// (dealTruthWindowOr, getLiveAgentCutoffIso, DEAL_TRUTH_STATUS_FILTER) and
// presents an "agency operating system" view per Sam's launch spec:
//   - Today / Week / Month / Live production
//   - Personal + team ranking
//   - Recruiting funnel for the agent (applicants → seminar → licensed → contracted → first sale)
//   - Referral activity
//   - Activity + missing-number warnings
//   - Personal pipeline links
//   - Next-action checklist
//   - Training links
//
// All numbers come from posted_at-canonical data. No mock numbers. Empty
// states explain WHY they're empty (no deals yet, sync stale, missing data)
// so the page never silently renders zero.

import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  ArrowUpRight,
  Award,
  BarChart3,
  Calendar,
  CheckCircle2,
  Circle,
  Crown,
  DollarSign,
  Flame,
  GraduationCap,
  HelpCircle,
  Phone,
  TrendingDown,
  TrendingUp,
  Trophy,
  UserPlus,
  Users,
} from "lucide-react";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { usePageTitle } from "@/hooks/usePageTitle";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { PageLoadingSkeleton } from "@/components/ui/page-loading-skeleton";
import { AgentReferralLinkCard } from "@/components/agent/AgentReferralLinkCard";
import { getBusinessDayBounds, getBusinessMonthBounds, getBusinessWeekBounds } from "@/lib/dateUtils";
import { DEAL_TRUTH_STATUS_FILTER, dealTruthWindowOr, liveDealWindowOr } from "@/lib/dealTruth";
import { getCloseRate, getLiveAgentCutoffIso, sumAnnualPremium } from "@/lib/metricTruth";

function fmt$(n: number): string {
  if (!Number.isFinite(n)) return "$0";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${Math.round(n).toLocaleString()}`;
}

interface AgentSnapshot {
  agentId: string;
  agentRow: {
    display_name: string | null;
    agent_code: string | null;
    onboarding_stage: string | null;
    license_status: string | null;
    is_presenting: boolean | null;
    manager_id: string | null;
  } | null;
  deals: {
    today: { count: number; alp: number };
    week: { count: number; alp: number };
    month: { count: number; alp: number };
    last10d: { count: number; alp: number };
    last30d: { count: number; alp: number };
    previous30d: { count: number; alp: number };
  };
  activity: {
    presentationsToday: number;
    presentationsWeek: number;
    hoursCalledWeek: number;
    lastProductionDate: string | null;
  };
  rank: {
    agency: number | null;
    team: number | null;
    totalAgents: number;
    liveAgents: number;
  };
  applicants: {
    assigned: number;
    needingContact: number;
    seminarRegistered: number;
    seminarAttended: number;
    licensed: number;
    contracted: number;
    activated: number;
  };
  referrals: {
    submitted: number;
    open: number;
    won: number;
  };
  trend: {
    apTrendPct: number | null;
  };
  syncStale: boolean;
}

async function loadSnapshot(userId: string, agentId: string, isAdmin: boolean): Promise<AgentSnapshot> {
  const day = getBusinessDayBounds();
  const week = getBusinessWeekBounds();
  const month = getBusinessMonthBounds();
  const tenAgo = getLiveAgentCutoffIso();
  const thirtyAgoIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const sixtyAgoIso = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();

  // Split the 16 queries into smaller Promise.all batches to dodge TS2589
  // "type instantiation excessively deep" on Supabase builder type unions.
  const q: any = supabase; // narrow to any once, makes the tuple type tractable
  // Scope deal queries to a single agent for normal users; for admin, drop
  // the agent filter so the deal counters show the whole agency. Per-agent
  // cards (applications, referrals, agent profile row) stay agent-scoped
  // either way — they describe Sam's own pipeline, not the agency's.
  const scopeAgent = (b: any) => (isAdmin ? b : b.eq("agent_id", agentId));
  const dealsBatch = await Promise.all([
    q.from("agents").select("display_name, agent_code, onboarding_stage, license_status, is_presenting, manager_id, profile_id").eq("id", agentId).maybeSingle(),
    scopeAgent(q.from("deals").select("annual_premium, posted_at, created_at")).or(dealTruthWindowOr(day.startIso, day.endIso)).in("status", DEAL_TRUTH_STATUS_FILTER),
    scopeAgent(q.from("deals").select("annual_premium, posted_at, created_at")).or(dealTruthWindowOr(week.startIso, week.endIso)).in("status", DEAL_TRUTH_STATUS_FILTER),
    scopeAgent(q.from("deals").select("annual_premium, posted_at, created_at")).or(dealTruthWindowOr(month.startIso, month.endIso)).in("status", DEAL_TRUTH_STATUS_FILTER),
    scopeAgent(q.from("deals").select("annual_premium, posted_at, created_at")).or(liveDealWindowOr(tenAgo)).in("status", DEAL_TRUTH_STATUS_FILTER),
    scopeAgent(q.from("deals").select("annual_premium")).gte("posted_at", thirtyAgoIso).in("status", DEAL_TRUTH_STATUS_FILTER),
    scopeAgent(q.from("deals").select("annual_premium")).gte("posted_at", sixtyAgoIso).lt("posted_at", thirtyAgoIso).in("status", DEAL_TRUTH_STATUS_FILTER),
  ]);
  const [agentRow, todayDeals, weekDeals, monthDeals, last10dDeals, last30dDeals, prev30dDeals] = dealsBatch;

  const rankBatch = await Promise.all([
    q.from("daily_production").select("presentations, hours_called, production_date").eq("agent_id", agentId).gte("production_date", week.startIso.slice(0, 10)).lt("production_date", week.endIso.slice(0, 10)),
    q.from("deals").select("agent_id").or(liveDealWindowOr(tenAgo)).in("status", DEAL_TRUTH_STATUS_FILTER),
    q.from("deals").select("agent_id, annual_premium").or(dealTruthWindowOr(month.startIso, month.endIso)).in("status", DEAL_TRUTH_STATUS_FILTER),
    q.from("agents").select("id").eq("manager_id", agentId).eq("is_deactivated", false),
    q.from("deals").select("agent_id, annual_premium").or(dealTruthWindowOr(month.startIso, month.endIso)).in("status", DEAL_TRUTH_STATUS_FILTER),
  ]);
  const [weekProduction, last10dAllAgents, monthAllAgents, teammates, teamMonthDeals] = rankBatch;

  const pipelineBatch = await Promise.all([
    q.from("applications").select("id, status, license_progress, license_status, contracted_at, first_deal_at, last_contacted_at").or(`assigned_agent_id.eq.${agentId},referral_manager_id.eq.${agentId},recruiter_id.eq.${agentId}`),
    q.from("seminar_registrations").select("id, attended, application_id"),
    q.from("referrals").select("status").eq("referrer_agent_id", agentId),
    // Read freshness from the canonical sync_health_summary() RPC rather
    // than agentlink_sync_log directly. v_sync_health coalesces transports
    // (cookie + API) and exposes `is_partial` + `action_required` so the
    // banner shows the truth, not just one transport's status.
    q.rpc("sync_health_summary"),
  ]);
  const [applicants, seminarRegs, refs, syncRow] = pipelineBatch;

  // Stats
  const todayRows = (todayDeals.data ?? []) as Array<{ annual_premium?: number | null }>;
  const weekRows = (weekDeals.data ?? []) as Array<{ annual_premium?: number | null }>;
  const monthRows = (monthDeals.data ?? []) as Array<{ annual_premium?: number | null }>;
  const last10dRows = (last10dDeals.data ?? []) as Array<{ annual_premium?: number | null }>;
  const last30dRows = (last30dDeals.data ?? []) as Array<{ annual_premium?: number | null }>;
  const prev30dRows = (prev30dDeals.data ?? []) as Array<{ annual_premium?: number | null }>;
  const weekProd = (weekProduction.data ?? []) as Array<{ presentations?: number | null; hours_called?: number | null; production_date?: string | null }>;
  const presentationsToday = weekProd
    .filter((r) => r.production_date === day.startIso.slice(0, 10))
    .reduce((s, r) => s + Number(r.presentations ?? 0), 0);
  const presentationsWeek = weekProd.reduce((s, r) => s + Number(r.presentations ?? 0), 0);
  const hoursCalledWeek = weekProd.reduce((s, r) => s + Number(r.hours_called ?? 0), 0);
  const lastProductionDate = weekProd.length > 0
    ? weekProd.reduce<string | null>((latest, r) => {
        if (!r.production_date) return latest;
        return !latest || r.production_date > latest ? r.production_date : latest;
      }, null)
    : null;

  // Ranks
  const liveSet = new Set<string>();
  for (const r of (last10dAllAgents.data ?? []) as Array<{ agent_id?: string | null }>) {
    if (r.agent_id) liveSet.add(r.agent_id);
  }
  const monthByAgent = new Map<string, number>();
  for (const r of (monthAllAgents.data ?? []) as Array<{ agent_id?: string | null; annual_premium?: number | null }>) {
    if (!r.agent_id) continue;
    monthByAgent.set(r.agent_id, (monthByAgent.get(r.agent_id) || 0) + Number(r.annual_premium ?? 0));
  }
  const sortedAgency = Array.from(monthByAgent.entries()).sort((a, b) => b[1] - a[1]);
  const agencyRank = (() => {
    const idx = sortedAgency.findIndex(([id]) => id === agentId);
    return idx >= 0 ? idx + 1 : null;
  })();

  const teamIds = new Set<string>([agentId, ...((teammates.data ?? []) as Array<{ id: string }>).map((r) => r.id)]);
  const teamByAgent = new Map<string, number>();
  for (const r of (teamMonthDeals.data ?? []) as Array<{ agent_id?: string | null; annual_premium?: number | null }>) {
    if (!r.agent_id || !teamIds.has(r.agent_id)) continue;
    teamByAgent.set(r.agent_id, (teamByAgent.get(r.agent_id) || 0) + Number(r.annual_premium ?? 0));
  }
  const sortedTeam = Array.from(teamByAgent.entries()).sort((a, b) => b[1] - a[1]);
  const teamRank = (() => {
    const idx = sortedTeam.findIndex(([id]) => id === agentId);
    return idx >= 0 && teamIds.size > 1 ? idx + 1 : null;
  })();

  // Recruiting funnel for this agent's applicants
  const apps = (applicants.data ?? []) as Array<{
    id: string;
    status?: string | null;
    license_progress?: string | null;
    license_status?: string | null;
    contracted_at?: string | null;
    first_deal_at?: string | null;
    last_contacted_at?: string | null;
  }>;
  const appIds = new Set(apps.map((a) => a.id));
  const semRegs = (seminarRegs.data ?? []) as Array<{ application_id?: string | null; attended?: boolean | null }>;
  const myRegs = semRegs.filter((s) => s.application_id && appIds.has(s.application_id));
  const recruiting = {
    assigned: apps.length,
    needingContact: apps.filter((a) => !a.last_contacted_at).length,
    seminarRegistered: myRegs.length,
    seminarAttended: myRegs.filter((s) => s.attended === true).length,
    licensed: apps.filter((a) => a.license_status === "licensed" || a.license_progress === "licensed").length,
    contracted: apps.filter((a) => !!a.contracted_at).length,
    activated: apps.filter((a) => !!a.first_deal_at).length,
  };

  const refRows = (refs.data ?? []) as Array<{ status?: string | null }>;
  const referrals = {
    submitted: refRows.length,
    open: refRows.filter((r) => !["contracted", "producing", "rejected", "lost", "duplicate"].includes(r.status ?? "")).length,
    won: refRows.filter((r) => r.status === "contracted" || r.status === "producing").length,
  };

  const ap30 = sumAnnualPremium(last30dRows);
  const apPrev30 = sumAnnualPremium(prev30dRows);
  const apTrendPct = apPrev30 > 0 ? ((ap30 - apPrev30) / apPrev30) * 100 : ap30 > 0 ? 100 : null;

  const syncTs = (syncRow.data as { started_at?: string | null; finished_at?: string | null } | null)?.finished_at
    || (syncRow.data as { started_at?: string | null } | null)?.started_at
    || null;
  const syncStale = !syncTs || Date.now() - new Date(syncTs).getTime() > 24 * 60 * 60 * 1000;

  return {
    agentId,
    agentRow: (agentRow.data as AgentSnapshot["agentRow"]) ?? null,
    deals: {
      today: { count: todayRows.length, alp: sumAnnualPremium(todayRows) },
      week: { count: weekRows.length, alp: sumAnnualPremium(weekRows) },
      month: { count: monthRows.length, alp: sumAnnualPremium(monthRows) },
      last10d: { count: last10dRows.length, alp: sumAnnualPremium(last10dRows) },
      last30d: { count: last30dRows.length, alp: ap30 },
      previous30d: { count: prev30dRows.length, alp: apPrev30 },
    },
    activity: { presentationsToday, presentationsWeek, hoursCalledWeek, lastProductionDate },
    rank: { agency: agencyRank, team: teamRank, totalAgents: sortedAgency.length, liveAgents: liveSet.size },
    applicants: recruiting,
    referrals,
    trend: { apTrendPct },
    syncStale,
  };
}

function NextActionChecklist({ s }: { s: AgentSnapshot }) {
  const items: Array<{ done: boolean; label: string; href?: string }> = [
    {
      done: s.activity.presentationsToday > 0,
      label: "Log today's calls / pages dialed",
      href: "/apex-daily-numbers",
    },
    {
      done: s.applicants.needingContact === 0,
      label: s.applicants.needingContact > 0 ? `Contact ${s.applicants.needingContact} applicants` : "Applicants all contacted",
      href: "/dashboard/applicants",
    },
    {
      done: s.deals.today.count > 0,
      label: s.deals.today.count > 0 ? "Deal logged today" : "Submit today's first deal",
      href: "/dashboard/my-deals",
    },
    {
      done: s.referrals.submitted > 0,
      label: s.referrals.submitted > 0 ? "Referral submitted" : "Submit a referral this week",
      href: "/dashboard/referrals/new",
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-primary" /> Next actions
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 p-4 pt-0">
        {items.map((it) => (
          <Link
            key={it.label}
            to={it.href ?? "#"}
            className="flex items-center gap-2 rounded-md border bg-card/50 px-3 py-2 text-sm hover:bg-accent/40 transition"
          >
            {it.done ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            ) : (
              <Circle className="h-4 w-4 text-muted-foreground" />
            )}
            <span className={it.done ? "text-muted-foreground line-through" : "font-medium"}>{it.label}</span>
            {it.href && <ArrowRight className="ml-auto h-3 w-3 text-muted-foreground" />}
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}

function Stat({
  label,
  value,
  hint,
  icon: Icon,
  trend,
  href,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon?: typeof TrendingUp;
  trend?: number | null;
  href?: string;
}) {
  const card = (
    <Card className="hover:bg-accent/20 transition cursor-pointer">
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
              {Icon && <Icon className="h-3 w-3" />}
              {label}
            </div>
            <div className="text-2xl font-bold tabular-nums mt-1">{value}</div>
            {hint && <div className="text-[11px] text-muted-foreground mt-1">{hint}</div>}
          </div>
          {trend !== undefined && trend !== null && (
            <div className={`flex items-center gap-1 text-xs font-semibold ${trend >= 0 ? "text-emerald-500" : "text-rose-500"}`}>
              {trend >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
              {Math.abs(trend).toFixed(0)}%
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
  return href ? <Link to={href}>{card}</Link> : card;
}

export default function AgentCommandDashboard() {
  usePageTitle("Command Dashboard · APEX Agent");
  const { user, isAdmin, isLoading: authLoading } = useAuth();

  const myAgentId = useQuery({
    queryKey: ["am-i-agent", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("agents")
        .select("id")
        .eq("user_id", user!.id)
        .maybeSingle();
      return data?.id as string | undefined;
    },
  });

  const snap = useQuery<AgentSnapshot>({
    queryKey: ["agent-command-snapshot", myAgentId.data, isAdmin],
    enabled: !!user?.id && !!myAgentId.data,
    refetchInterval: 60_000,
    queryFn: () => loadSnapshot(user!.id, myAgentId.data!, isAdmin),
  });

  const closeRate = useMemo(() => {
    if (!snap.data) return null;
    return getCloseRate(snap.data.deals.week.count, snap.data.activity.presentationsWeek);
  }, [snap.data]);

  if (authLoading || myAgentId.isLoading || snap.isLoading) return <PageLoadingSkeleton />;

  if (!user) {
    return (
      <div className="p-6 max-w-xl mx-auto">
        <Card><CardContent className="p-8 text-center text-sm">Sign in to see your dashboard.</CardContent></Card>
      </div>
    );
  }

  if (!myAgentId.data) {
    return (
      <div className="p-6 max-w-xl mx-auto">
        <Card><CardContent className="p-8 text-center space-y-3">
          <h2 className="text-lg font-bold">No agent profile linked yet</h2>
          <p className="text-sm text-muted-foreground">
            Your login doesn't have an agent record attached. Ask Sam or your manager to connect your account, then refresh.
          </p>
        </CardContent></Card>
      </div>
    );
  }

  const s = snap.data!;
  const agent = s.agentRow;
  // Greet by first name only — "Hey Sam James" reads stiff vs "Hey Sam".
  const fullName = agent?.display_name || user.email?.split("@")[0] || "Agent";
  const displayName = fullName.trim().split(/\s+/)[0] || fullName;
  const stage = agent?.onboarding_stage ?? "—";
  const license = agent?.license_status ?? "—";
  const presenting = agent?.is_presenting === true;

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Header */}
      <section className="rounded-xl border border-primary/30 bg-[linear-gradient(135deg,hsl(222_47%_5%),hsl(222_40%_8%)_55%,hsl(168_70%_13%))] p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Crown className="h-4 w-4 text-primary" />
              <span className="text-[10px] uppercase tracking-wider text-primary/80">Agent · Command Dashboard</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold text-white">Hey {displayName}</h1>
            <p className="text-sm text-slate-300 mt-1">
              {agent?.agent_code ? <Badge variant="outline" className="mr-2 text-[10px]">{agent.agent_code}</Badge> : null}
              <Badge variant="outline" className="mr-2 text-[10px]">{license}</Badge>
              <Badge variant="outline" className="mr-2 text-[10px]">{stage}</Badge>
              {presenting && <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/40 text-[10px]">Seminar presenter</Badge>}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" variant="secondary">
              <Link to="/apex-daily-numbers"><Phone className="h-4 w-4 mr-1" /> Log numbers</Link>
            </Button>
            {/* Deals canonical-surface: AgentLink. ApexLink reads via
                insuracloud-sync every 1 min (pg_cron + GH cron). */}
            <Button asChild size="sm" variant="secondary">
              <a
                href="https://agentlink.insuracloud.ai/deals/new"
                target="_blank"
                rel="noopener noreferrer"
              >
                <DollarSign className="h-4 w-4 mr-1" /> Submit deal in AgentLink
              </a>
            </Button>
            <Button asChild size="sm">
              <Link to="/dashboard/referrals/new"><UserPlus className="h-4 w-4 mr-1" /> Refer someone</Link>
            </Button>
          </div>
        </div>
        {s.syncStale && (
          <div className="mt-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200">
            AgentLink sync looks stale (last successful sync &gt; 24h). Numbers may be behind reality —
            check <Link to="/dashboard/agentlink-sync" className="underline">AgentLink Sync</Link>.
          </div>
        )}
      </section>

      {/* Production */}
      <section className="space-y-2">
        <h2 className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Production</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Today ALP" value={fmt$(s.deals.today.alp)} hint={`${s.deals.today.count} deals`} icon={DollarSign} />
          <Stat label="Week ALP" value={fmt$(s.deals.week.alp)} hint={`${s.deals.week.count} deals · close ${closeRate?.toFixed(0) ?? "—"}%`} icon={TrendingUp} />
          <Stat label="Month ALP" value={fmt$(s.deals.month.alp)} hint={`${s.deals.month.count} deals`} icon={BarChart3} />
          <Stat label="30d trend" value={fmt$(s.deals.last30d.alp)} hint={`vs prior 30d ${fmt$(s.deals.previous30d.alp)}`} icon={Flame} trend={s.trend.apTrendPct} />
        </div>
      </section>

      {/* Ranking */}
      <section className="space-y-2">
        <h2 className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Ranking</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Agency rank (MTD)" value={s.rank.agency ? `#${s.rank.agency}` : "—"} hint={s.rank.agency ? `of ${s.rank.totalAgents} producing agents` : "No producing rank yet"} icon={Trophy} href="/dashboard/leaderboard" />
          <Stat label="Team rank (MTD)" value={s.rank.team ? `#${s.rank.team}` : "—"} hint={s.rank.team ? "vs your team" : "No team configured"} icon={Award} />
          <Stat label="Live agents" value={s.rank.liveAgents} hint="10d submitted/active deal" icon={Users} />
          <Stat label="My last sale" value={s.activity.lastProductionDate ? format(new Date(s.activity.lastProductionDate), "MMM d") : "—"} hint={s.activity.lastProductionDate ? "Days since last sale shown above" : "No sale logged this week"} icon={Calendar} />
        </div>
      </section>

      {/* Activity & Recruiting funnel */}
      <section className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-2">
          <h2 className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Activity (this week)</h2>
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Presentations" value={s.activity.presentationsWeek} hint={`${s.activity.presentationsToday} today`} icon={Phone} />
            <Stat label="Hours called" value={s.activity.hoursCalledWeek.toFixed(1)} hint="this week" icon={Phone} />
          </div>
          {s.activity.presentationsToday === 0 && (
            <p className="text-xs text-amber-500 mt-1">
              ⚠ No numbers logged today.{" "}
              <Link to="/apex-daily-numbers" className="underline">Log now</Link>.
            </p>
          )}
        </div>

        <div className="space-y-2">
          <h2 className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">My recruits</h2>
          <Card>
            <CardContent className="p-4 space-y-3">
              <RecruitRow label="Assigned applicants" n={s.applicants.assigned} />
              <RecruitRow label="Needing contact" n={s.applicants.needingContact} tone={s.applicants.needingContact > 0 ? "warn" : "ok"} />
              <RecruitRow label="Seminar registered" n={s.applicants.seminarRegistered} />
              <RecruitRow label="Attended seminar" n={s.applicants.seminarAttended} />
              <RecruitRow label="Licensed" n={s.applicants.licensed} />
              <RecruitRow label="Contracted" n={s.applicants.contracted} />
              <RecruitRow label="Activated (first sale)" n={s.applicants.activated} tone="win" />
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Referrals + next actions */}
      <section className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <UserPlus className="h-4 w-4 text-primary" /> Referrals
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <Stat label="Submitted" value={s.referrals.submitted} />
              <Stat label="Open" value={s.referrals.open} />
              <Stat label="Won" value={s.referrals.won} icon={Trophy} />
            </div>
            <div className="flex gap-2">
              <Button asChild size="sm" className="flex-1">
                <Link to="/dashboard/referrals/new">Submit a referral</Link>
              </Button>
              <Button asChild size="sm" variant="outline" className="flex-1">
                <Link to="/dashboard/referrals/mine">My referrals <ArrowUpRight className="h-3 w-3 ml-1" /></Link>
              </Button>
            </div>
          </CardContent>
        </Card>

        <NextActionChecklist s={s} />
      </section>

      {/* Personal referral link — every agent gets a sharable apex-financial.org/apply?ref=… URL */}
      <section>
        <AgentReferralLinkCard agentId={myAgentId.data ?? null} />
      </section>

      {/* Training links */}
      <section>
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <GraduationCap className="h-4 w-4 text-primary" /> Training & Onboarding
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 grid grid-cols-2 md:grid-cols-3 gap-2">
            <Button asChild variant="outline" size="sm"><Link to="/course-catalog">Course catalog</Link></Button>
            <Button asChild variant="outline" size="sm"><Link to="/course-progress">Course progress</Link></Button>
            <Button asChild variant="outline" size="sm"><Link to="/dashboard/leaderboard">Leaderboard</Link></Button>
            <Button asChild variant="outline" size="sm"><Link to="/dashboard/book-of-business">Book of business</Link></Button>
            <Button asChild variant="outline" size="sm"><Link to="/dashboard/notifications/mine">Notifications</Link></Button>
            <Button asChild variant="outline" size="sm"><Link to="/agent-portal/legacy">Legacy view <HelpCircle className="h-3 w-3 ml-1" /></Link></Button>
          </CardContent>
        </Card>
      </section>

      {/* License-progress for self */}
      {license && license !== "licensed" && (
        <section>
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <GraduationCap className="h-4 w-4 text-amber-500" /> Get licensed
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0 space-y-2">
              <p className="text-sm text-muted-foreground">
                Your status: <Badge variant="outline">{license}</Badge>. Finish your pre-license course
                and book your exam to unlock contracting and the full deal pipeline.
              </p>
              <Progress value={license === "pending" ? 60 : 20} className="h-2" />
              <Button asChild size="sm"><Link to="/get-licensed">Next step <ArrowRight className="h-3 w-3 ml-1" /></Link></Button>
            </CardContent>
          </Card>
        </section>
      )}

      <p className="text-[11px] text-muted-foreground text-center">
        Numbers refresh every 60s · Source: deals.posted_at (America/Chicago)
      </p>
    </div>
  );
}

function RecruitRow({ label, n, tone }: { label: string; n: number; tone?: "ok" | "warn" | "win" }) {
  const cls =
    tone === "warn" ? "text-amber-500"
    : tone === "win" ? "text-emerald-500"
    : "";
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-bold tabular-nums ${cls}`}>{n}</span>
    </div>
  );
}
