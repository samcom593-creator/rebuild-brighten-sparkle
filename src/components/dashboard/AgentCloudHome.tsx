import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  AlertTriangle, ArrowRight, CheckCircle2, ChevronDown, LineChart as LineChartIcon,
  RefreshCw, Shield, TrendingUp, UserPlus, Users,
} from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ImoByAgency } from "@/components/dashboard/ImoByAgency";
import { TrainingNextStep } from "@/components/dashboard/TrainingNextStep";
import { JoinYourTeam } from "@/components/dashboard/JoinYourTeam";
import { ProducerPulse } from "@/components/dashboard/ProducerPulse";
import { RecordsAndBounties } from "@/components/dashboard/RecordsAndBounties";
import { SubmitDealDialog } from "@/components/deals/SubmitDealDialog";
import { ScopedProductionScoreboard } from "@/components/dashboard/ScopedProductionScoreboard";
import { OperationsCommandCenter } from "@/components/dashboard/OperationsCommandCenter";
import { JustHiredPanel } from "@/components/dashboard/JustHiredPanel";
import { OnboardingRollCall } from "@/components/dashboard/OnboardingRollCall";
import { cn } from "@/lib/utils";
import { useProductionRealtime } from "@/hooks/useProductionRealtime";
import { invalidateOperationalTruth } from "@/lib/invalidateOperationalTruth";
import { resolveBrand } from "@/config/brand";

const BRAND = resolveBrand();

// APEX native operating dashboard. Historical references informed the visual
// hierarchy only; live workflows never depend on AgentLink or InsuraCloud.
//
// EVERY number comes from ONE server-side RPC (apex_admin_home_dashboard). The page
// this replaces fired ~20 client-side queries — measured on a live load as 33
// API calls including agentlink_deals_snapshot EIGHT times and agents SEVEN
// times — several against the legacy `deals` table, and derived headline counts
// from arrays PostgREST silently caps at 1000 rows. That is both why the
// dashboard felt laggy and why it disagreed with the leaderboard.

interface HomeData {
  as_of: string;
  today: { personal_ap: number; personal_policies: number; team_ap: number; team_policies: number };
  mtd: { personal_ap: number; personal_policies: number; team_ap: number; team_policies: number; goal: number; pct_to_goal: number; days_left: number };
  lifetime: { ap: number; policies: number };
  trend: Array<{ m: string; ap: number; policies: number }>;
  leaderboard: Array<{ name: string; ap: number; deals: number }>;
  policy_status: Record<string, number>;
  roster: { total: number; producing: number; in_onboarding: number };
  needs_attention: { lapse_pending: number; in_chargeback_window: number; dormant_producers: number };
}

// Phoenix-local date maths so the window a user picks is the window the RPC
// applies. Building these from `new Date()` in the browser's zone would slide
// the boundary by up to a day for anyone outside Arizona.
const PHX = "en-CA"; // yyyy-mm-dd
const phxToday = () => new Date(new Date().toLocaleString("en-US", { timeZone: "America/Phoenix" }));
const iso = (d: Date) => d.toLocaleDateString(PHX, { timeZone: "America/Phoenix" });
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

type PeriodKey = "this_month" | "last_month" | "last_30" | "last_90" | "ytd" | "custom";
function windowFor(key: PeriodKey, custom: { start: string; end: string }): { start: string; end: string; label: string } {
  const t = phxToday();
  const mStart = new Date(t.getFullYear(), t.getMonth(), 1);
  switch (key) {
    case "last_month": {
      const s = new Date(t.getFullYear(), t.getMonth() - 1, 1);
      return { start: iso(s), end: iso(mStart), label: s.toLocaleDateString(undefined, { month: "long", year: "numeric" }) };
    }
    case "last_30":  return { start: iso(addDays(t, -29)), end: iso(addDays(t, 1)), label: "Last 30 days" };
    case "last_90":  return { start: iso(addDays(t, -89)), end: iso(addDays(t, 1)), label: "Last 90 days" };
    case "ytd":      return { start: iso(new Date(t.getFullYear(), 0, 1)), end: iso(addDays(t, 1)), label: `${t.getFullYear()} to date` };
    case "custom":   return {
      start: custom.start,
      end: iso(addDays(new Date(`${custom.end}T12:00:00`), 1)),
      label: `${custom.start} - ${custom.end}`,
    };
    default:         return { start: iso(mStart), end: iso(new Date(t.getFullYear(), t.getMonth() + 1, 1)), label: "This month" };
  }
}
const PERIODS: Array<{ key: PeriodKey; label: string }> = [
  { key: "this_month", label: "This month" },
  { key: "last_month", label: "Last month" },
  { key: "last_30", label: "Last 30 days" },
  { key: "last_90", label: "Last 90 days" },
  { key: "ytd", label: "Year to date" },
  { key: "custom", label: "Custom range" },
];

const money = (n: number | null | undefined) => `$${Math.round(Number(n ?? 0)).toLocaleString()}`;
const monthShort = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, 1).toLocaleDateString(undefined, { month: "short", year: "2-digit" });
};

// Order and copy follow the AC reference exactly. status_not_reported is APEX's
// own honest bucket: AgentLink returns policyStatus=None for 1,304 of 1,731
// deals upstream, and folding that into "Carrier N/A" would dress a data gap as
// a carrier problem.
const STATUS_TILES: Array<{ key: string; label: string; tone: string }> = [
  { key: "active", label: "Active", tone: "text-emerald-500" },
  { key: "issued_not_paid", label: "Issued, Not Paid", tone: "text-emerald-400" },
  { key: "in_review", label: "In Review", tone: "text-sky-400" },
  { key: "lapse_pending", label: "Lapse Pending", tone: "text-amber-400" },
  { key: "lapsed", label: "Lapsed", tone: "text-rose-400" },
  { key: "cancelled", label: "Cancelled", tone: "text-rose-500" },
  { key: "withdrawn", label: "Withdrawn", tone: "text-muted-foreground" },
  { key: "not_taken", label: "Not Taken", tone: "text-amber-500" },
  { key: "postponed", label: "Postponed", tone: "text-muted-foreground" },
  { key: "status_not_reported", label: "Status not reported", tone: "text-muted-foreground" },
];

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="border-b border-border p-4 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1.5 text-2xl font-bold tabular-nums text-foreground">{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

export function AgentCloudHome() {
  const queryClient = useQueryClient();
  const today = phxToday();
  const [period, setPeriod] = useState<PeriodKey>("this_month");
  const [custom, setCustom] = useState({
    start: iso(addDays(today, -30)),
    end: iso(today),
  });
  const customIsValid = custom.start.length === 10 && custom.end.length === 10 && custom.start <= custom.end;
  const win = windowFor(period, custom);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["apex-home-dashboard", win.start, win.end],
    staleTime: 120_000,
    // No poll. MEASURED: apex_admin_home_dashboard is the platform's second
    // most expensive call — 10,755 calls averaging 2,205ms, 6.6 hours of
    // database time. It refreshes from the realtime channel below instead,
    // which is both cheaper and fresher than waiting up to 5 minutes.
    refetchOnWindowFocus: false,
    enabled: period !== "custom" || customIsValid,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("apex_admin_home_dashboard" as never, {
        p_start: win.start,
        p_end: win.end,
      } as never);
      if (error) throw error;
      return data as unknown as HomeData;
    },
  });

  // Realtime instead of the 5-minute poll it replaced.
  useProductionRealtime(() => { void refetch(); }, 800);

  useProductionRealtime(() => invalidateOperationalTruth(queryClient), 350);

  const PeriodPicker = (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {period === "custom" && (
        <div className="flex items-center gap-1.5">
          <Input
            aria-label="Start date"
            className="h-8 w-[132px] text-xs"
            type="date"
            value={custom.start}
            onChange={(event) => setCustom((value) => ({ ...value, start: event.target.value }))}
          />
          <span className="text-xs text-muted-foreground">to</span>
          <Input
            aria-label="End date"
            className="h-8 w-[132px] text-xs"
            type="date"
            value={custom.end}
            onChange={(event) => setCustom((value) => ({ ...value, end: event.target.value }))}
          />
        </div>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline">{PERIODS.find((item) => item.key === period)?.label}</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {PERIODS.map((item) => (
            <DropdownMenuItem key={item.key} onSelect={() => setPeriod(item.key)}>
              {item.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );

  if (isLoading || !data) {
    if (isError) {
      return (
        <Card>
          <CardContent className="p-8 text-center">
            <AlertTriangle className="mx-auto h-6 w-6 text-destructive" />
            <p className="mt-3 font-semibold">The {BRAND.platformName} operating dashboard could not load</p>
            <p className="mt-1 text-sm text-muted-foreground">No dashboard totals are being guessed. Retry the secured source.</p>
            <Button variant="outline" className="mt-4 gap-2" onClick={() => void refetch()}>
              <RefreshCw className="h-4 w-4" /> Retry
            </Button>
          </CardContent>
        </Card>
      );
    }
    return (
      <div className="space-y-5">
        <div className="grid gap-3 lg:grid-cols-[1fr_320px]">
          <Skeleton className="h-48 rounded-lg" /><Skeleton className="h-48 rounded-lg" />
        </div>
        <Skeleton className="h-64 rounded-lg" />
      </div>
    );
  }

  const { mtd, needs_attention: na, roster, policy_status } = data;
  const attention = [
    na.lapse_pending > 0 && { label: `${na.lapse_pending} policies pending lapse`, to: "/dashboard/retention", tone: "text-amber-500" },
    na.dormant_producers > 0 && { label: `${na.dormant_producers} producers dormant 45+ days`, to: "/dashboard/team", tone: "text-rose-400" },
    na.in_chargeback_window > 0 && { label: `${na.in_chargeback_window} policies inside the chargeback window`, to: "/dashboard/production", tone: "text-sky-400" },
  ].filter(Boolean) as Array<{ label: string; to: string; tone: string }>;

  const trend = (data.trend ?? []).map((t) => ({ ...t, name: monthShort(t.m) }));

  return (
    <div className="space-y-5">
      {/* Training first, above production. Sam: "as soon as they log in, the
          first time, you should see it" — the module course had 92 agents in it
          and the Training Hub 6, because nothing on the home screen pointed at
          either. Renders nothing for a viewer with no agent record. */}
      {/* MP-342: new hires reported they could not find the Discord. Both
          invites were live; they just were not reachable anywhere in the
          product. Self-hides once onboarding completes. */}
      <JoinYourTeam />
      <TrainingNextStep />
      <ScopedProductionScoreboard />
      <OperationsCommandCenter />
      {/* Recent hires — names + who they're routed to + when, so Sam can follow
          up directly. Independent of AgentLink/InsuraCloud: reads agents/hires. */}
      <JustHiredPanel />
      {/* MP-339: who is new and still not in, with each blocker named. Renders
          nothing when the viewer has no new hires. */}
      <OnboardingRollCall />

      {/* WHAT NEEDS YOU TODAY */}
      <div>
        <div className="mb-2 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-foreground">What needs you today</h2>
          {PeriodPicker}
        </div>
        {attention.length === 0 ? (
          <Card className="border-emerald-500/30 bg-emerald-500/[0.06]">
            <CardContent className="flex items-center gap-2.5 p-4">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              <p className="text-sm text-foreground">You&rsquo;re clear. Nothing is overdue and nothing is waiting on you.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-2 sm:grid-cols-3">
            {attention.map((a) => (
              <Link key={a.to + a.label} to={a.to}>
                <Card className="transition-colors hover:border-primary/40">
                  <CardContent className="flex items-center gap-2.5 p-4">
                    <AlertTriangle className={cn("h-4 w-4 shrink-0", a.tone)} />
                    <p className="text-sm text-foreground">{a.label}</p>
                    <ArrowRight className="ml-auto h-3.5 w-3.5 text-muted-foreground" />
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* SELECTED PERIOD PRODUCTION + ALP */}
      <div>
        <Card>
          <CardContent className="p-5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{period === "this_month" ? "Month-to-date ALP" : "ALP · " + win.label}</p>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-3">
              <p className="text-4xl font-bold tabular-nums text-primary">{money(mtd.team_ap)}</p>
              <p className="text-sm font-semibold tabular-nums text-foreground">{mtd.team_policies.toLocaleString()} policies</p>
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              Goal {money(mtd.goal)} · <span className="font-semibold text-foreground">{mtd.pct_to_goal}% there</span>{mtd.days_left > 0 ? ` · ${mtd.days_left} days left` : ""} · all-time {data.lifetime.policies.toLocaleString()} policies
            </p>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, mtd.pct_to_goal)}%` }} />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <SubmitDealDialog trigger={<Button size="sm">Post a Deal</Button>} />
              <Button asChild size="sm" variant="outline"><Link to="/dashboard/leaderboard">Leaderboard</Link></Button>
              <Button asChild size="sm" variant="outline"><Link to="/dashboard/production">Production</Link></Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ROSTER + IMO */}
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <Card><CardContent className="p-4">
              <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"><Users className="h-3 w-3" />Roster</p>
              <p className="mt-1.5 text-2xl font-bold tabular-nums">{roster.total}</p>
              <p className="text-[11px] text-muted-foreground">agents on the team</p>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"><TrendingUp className="h-3 w-3" />Producing</p>
              <p className="mt-1.5 text-2xl font-bold tabular-nums text-emerald-500">{roster.producing}</p>
              <p className="text-[11px] text-muted-foreground">wrote business in 120d</p>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"><UserPlus className="h-3 w-3" />In onboarding</p>
              <p className="mt-1.5 text-2xl font-bold tabular-nums text-amber-500">{roster.in_onboarding}</p>
              <p className="text-[11px] text-muted-foreground">active, no production yet</p>
            </CardContent></Card>
          </div>
          <ImoByAgency start={win.start} end={win.end} windowLabel={win.label} />
        </div>

        {/* LEADERBOARD */}
        <Card>
          <CardContent className="p-4">
            <div className="mb-3 flex items-baseline justify-between">
              <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">Leaderboard</p>
              <Link to="/dashboard/leaderboard" className="text-xs text-primary hover:underline">View all</Link>
            </div>
            {data.leaderboard.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">No production yet this period.</p>
            ) : (
              <div className="space-y-2">
                {data.leaderboard.slice(0, 8).map((r, i) => (
                  <div key={r.name} className="flex items-center gap-3 text-sm">
                    <span className="w-5 shrink-0 text-xs font-bold tabular-nums text-muted-foreground">#{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate">{r.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{r.deals}d</span>
                    <span className="w-20 shrink-0 text-right font-semibold tabular-nums">{money(r.ap)}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <ProducerPulse />
      <RecordsAndBounties />

      {/* MP-338 declutter. Sam: "so much options, that looks kinda cluttery."
          The home stacked ten full-width sections; the bottom two are the
          analytical ones an agent reads occasionally, not daily. Collapsed by
          default behind a disclosure rather than DELETED — the rule on this
          codebase is that a surface is never removed to tidy a page, because
          the numbers on it are the only place some of them exist. Native
          <details> so it needs no state, no library, and stays keyboard- and
          screen-reader-operable. The chart also stops mounting on first paint,
          which is the single heaviest thing on this route. */}
      <details className="group [&[open]_.chev]:rotate-180">
        <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg border border-border bg-card px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground hover:text-foreground">
          <LineChartIcon className="h-3.5 w-3.5" />
          Trend and policy status
          <ChevronDown className="chev ml-auto h-4 w-4 transition-transform" />
        </summary>
        <div className="mt-3 space-y-5">

      {/* PRODUCTION TREND */}
      <Card>
        <CardContent className="p-4">
          <p className="mb-3 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
            <LineChartIcon className="h-3 w-3" />Production trend · 12 months
          </p>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trend} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} width={56}
                  domain={[0, (dataMax: number) => Math.ceil((dataMax * 1.2) / 5000) * 5000]}
                  tickFormatter={(v: number) => `$${Math.round(v / 1000)}k`} />
                <ChartTooltip formatter={(v: number) => money(v)}
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                <Area type="monotone" dataKey="ap" name="ALP" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.16} strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* POLICY STATUS */}
      <Card>
        <CardContent className="p-4">
          <div className="mb-3 flex items-baseline justify-between">
            <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
              <Shield className="h-3 w-3" />Policy status
            </p>
            <span className="text-[11px] text-muted-foreground">{data.lifetime.policies.toLocaleString()} policies · {money(data.lifetime.ap)} book</span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {STATUS_TILES.map((t) => (
              <div key={t.key} className="rounded-lg border border-border bg-background/40 p-3">
                <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{t.label}</p>
                <p className={cn("mt-1 text-xl font-bold tabular-nums", t.tone)}>{(policy_status?.[t.key] ?? 0).toLocaleString()}</p>
              </div>
            ))}
          </div>
          {(policy_status?.status_not_reported ?? 0) > 0 && (
            <p className="mt-3 text-[11px] text-muted-foreground">
              <Badge variant="outline" className="mr-1.5 border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400">Upstream gap</Badge>
              The legacy book does not report a policy status for {(policy_status.status_not_reported).toLocaleString()} of these historical policies, so lapse and chargeback tracking is blind on them.
            </p>
          )}
        </CardContent>
      </Card>
        </div>
      </details>
    </div>
  );
}
