import { Suspense, lazy, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { ChevronDown, LineChart as LineChartIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { QueryState, describeQuery } from "@/components/ui/query-state";
import { ImoByAgency } from "@/components/dashboard/ImoByAgency";
import { TrainingNextStep } from "@/components/dashboard/TrainingNextStep";
import { JoinYourTeam } from "@/components/dashboard/JoinYourTeam";
import { HomeOperationsSummary } from "@/components/dashboard/HomeOperationsSummary";
import { RecordsAndBounties } from "@/components/dashboard/RecordsAndBounties";
import { ScopedProductionScoreboard } from "@/components/dashboard/ScopedProductionScoreboard";
import { HomeConversions, SellingAgentsTile } from "@/components/dashboard/HomeConversions";
import { OperationsCommandCenter } from "@/components/dashboard/OperationsCommandCenter";
import { useProductionRealtime } from "@/hooks/useProductionRealtime";
import { useBusinessToday } from "@/hooks/useBusinessToday";
import { invalidateOperationalTruth } from "@/lib/invalidateOperationalTruth";
import type { HomeData } from "@/lib/homeDashboard";
import { scoreboardWindow, type ScoreboardPeriod } from "@/lib/scoreboardPeriod";

// F24: the only Recharts consumer on the Home route. Lazy, and rendered only
// after the "Trend and policy status" disclosure has been opened once, so a
// cold visit neither requests the vendor-charts chunk nor mounts the chart.
const HomeAnalyticsPanel = lazy(() =>
  import("@/components/dashboard/HomeAnalyticsPanel").then((m) => ({ default: m.HomeAnalyticsPanel })),
);

// APEX native operating dashboard. Historical references informed the visual
// hierarchy only; live workflows never depend on AgentLink or InsuraCloud.
//
// Every number comes from a server-side RPC, never from client arrays: the
// conversion strip and Selling agents from home_conversion_people (OVERHAUL-home,
// 2026-10-29), the trend and policy status under Reports from
// apex_admin_home_dashboard, production from the scoreboard's own RPC. The page
// this replaced fired ~20 client-side queries — measured on a live load as 33
// API calls including agentlink_deals_snapshot EIGHT times and agents SEVEN
// times — several against the legacy `deals` table, and derived headline counts
// from arrays PostgREST silently caps at 1000 rows. That is both why the
// dashboard felt laggy and why it disagreed with the leaderboard.
//
// F22: the window the RPC is asked for is built from the Phoenix business-day
// KEY (useBusinessToday) with the key-space helpers in src/lib/homeDashboard.
// The builder this replaces took local midnight of the 1st in the browser's
// zone and formatted it in Phoenix, which put the October start on 2026-09-30
// for every viewer east of Arizona and read "today" as yesterday under UTC.
// Nothing in this file constructs a Date or formats one.

export function AgentCloudHome() {
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();
  // The Phoenix business day, kept live across midnight and tab wake-ups.
  const todayKey = useBusinessToday();
  // ONE date bar for every production number on Home (Galaxy map, Home gate). The
  // scoreboard renders the controls; Home owns the state, so the dashboard RPC and
  // Total IMO by agency read the exact window the scoreboard shows. Two pickers gave
  // two answers for the same month: "This month" ran to Nov 1 and counted policies
  // dated later in October, while the scoreboard read month to date.
  const [period, setPeriod] = useState<ScoreboardPeriod>("month");
  // The window follows the business day until someone picks another date: a picked
  // date sticks, "today" rolls over at Phoenix midnight and after a laptop wake. Seeding
  // useState with todayKey froze Home on the day the page mounted.
  const [pickedDate, setPickedDate] = useState<string | null>(null);
  const throughDate = pickedDate ?? todayKey;
  const setThroughDate = (d: string) => setPickedDate(d === todayKey ? null : d);
  const win = scoreboardWindow(period, throughDate);
  // F24: the analytics panel mounts on the first expansion and stays mounted
  // afterwards, so re-opening does not refetch the chunk or lose chart state.
  const [analyticsOpened, setAnalyticsOpened] = useState(false);
  const home = useQuery({
    queryKey: ["apex-home-dashboard", win.start, win.end],
    // OVERHAUL-home (2026-10-29): the trend chart and policy status under Reports are the
    // only things left on Home that read this RPC (the vanity roster tiles that also read
    // it are gone), so it waits until that panel is opened instead of costing every visit
    // ~2.2s of database time for numbers nobody is looking at.
    enabled: analyticsOpened,
    staleTime: 120_000,
    // No poll. MEASURED: apex_admin_home_dashboard is the platform's second
    // most expensive call — 10,755 calls averaging 2,205ms, 6.6 hours of
    // database time. It refreshes from the realtime channel below instead,
    // which is both cheaper and fresher than waiting up to 5 minutes.
    refetchOnWindowFocus: false,
    // MP-431: a timed-out call has already burned its 8s of database time; one
    // retry after the 15s single-flight window has had time to fill, not two
    // back-to-back.
    retry: 1,
    retryDelay: 4_000,
    queryFn: async (): Promise<HomeData> => {
      const { data, error } = await supabase.rpc("apex_admin_home_dashboard" as never, {
        p_start: win.start,
        p_end: win.end,
      } as never);
      if (error) throw error;
      return data as unknown as HomeData;
    },
  });
  const { data, refetch } = home;

  // Realtime instead of the 5-minute poll it replaced.
  // MP-431: cancelRefetch defaults to true, which aborted the in-flight call on
  // every realtime flush and started another while the database kept executing
  // the abandoned one. Let the in-flight call finish and dedupe onto it.
  useProductionRealtime(() => { if (analyticsOpened) void refetch({ cancelRefetch: false }); }, 800);

  // MP-436: broadcast:false is LOAD-BEARING. This callback runs FROM the
  // "production-realtime-update" event; re-emitting it here closed a ring that
  // re-drove itself every 350ms on zero row changes, calling the platform's
  // three most expensive RPCs at ~45/min for as long as this page was open.
  useProductionRealtime(
    () => invalidateOperationalTruth(queryClient, { broadcast: false }),
    350,
  );

  // F23: no early return. The page frame and the period controls are always in
  // the tree; only the blocks that depend on the RPC change state, and a
  // failed refresh keeps the last loaded numbers on screen under an as-of label.
  const homeState = describeQuery(home);

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
      {/* MP-430 (Sam, 2026-09-04: "zero clutter"): the owner does not need his
          own course-progress card above the money. Agents and managers keep
          training first — that placement is what moved 92 agents into the
          course. */}
      {!isAdmin && <TrainingNextStep />}
      {/* OVERHAUL-home (Sam, 2026-10-28: "Give me better stats and make it easier for me to
          convert"). First on the owner's Home: the funnel from a new application to a first
          deal, every number opening the people it counts. Admin only, like its RPC. */}
      {isAdmin && <HomeConversions />}
      <ScopedProductionScoreboard control={{ period, throughDate, onPeriodChange: setPeriod, onThroughDateChange: setThroughDate }} />

      {/* OVERHAUL-home: the all-time Ayro Financial production block that sat here is off
          Home (Sam: remove the all-time production section). Its numbers are unchanged and
          still live on Book of Business (/dashboard/production), which renders the same
          AyroProductionPanel. */}

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList aria-label="Dashboard views">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="operations">Operations</TabsTrigger>
          <TabsTrigger value="reports">Reports</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="space-y-4">
      {/* MP-430: straight from the scoreboard to Total IMO by agency. The three
          amber panels that used to sit here (just-hired, roll call, unlinked
          agents) now live on /dashboard/team under "Roster health" — Sam: "what
          am I gonna do with any of those boxes ... just go to total IMO by
          agency." The "what needs you today" cards and the month-to-date card
          restated numbers the scoreboard and the ops tiles already carry, so
          they are gone rather than moved. */}
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="space-y-3">
          {/* OVERHAUL-home: the roster number, fixed. "Roster 68 · Producing 9 · No sale yet 59"
              counted every agent row marked active, and its Producing number read only the
              AgentLink book, which stopped receiving deals. Selling agents is the licensed
              agents with a posted deal in the last 30 days, and it opens every one of them. */}
          {isAdmin && <SellingAgentsTile />}
          <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 pt-1">
            <h2 className="text-sm font-semibold text-foreground">Total IMO by agency</h2>
            <p className="text-xs text-muted-foreground">{win.label} · same dates as the scoreboard</p>
          </div>
          <ImoByAgency start={win.start} end={win.end} windowLabel={win.label} hideTitle />
        </div>

        {/* Operations flow sits beside IMO: recruit → interview → hire → onboard →
            contract → sell, one truthful queue each. */}
        <OperationsCommandCenter />
      </div>

        </TabsContent>
        <TabsContent value="operations" className="space-y-4">
          <HomeOperationsSummary />
        </TabsContent>
        <TabsContent value="reports" className="space-y-4">
          <RecordsAndBounties />

      {/* MP-338 declutter. Sam: "so much options, that looks kinda cluttery."
          The home stacked ten full-width sections; the bottom two are the
          analytical ones an agent reads occasionally, not daily. Collapsed by
          default behind a disclosure rather than DELETED — the rule on this
          codebase is that a surface is never removed to tidy a page, because
          the numbers on it are the only place some of them exist. Native
          <details> so it needs no library and stays keyboard- and
          screen-reader-operable. F24: a closed <details> only hides its
          children, so the panel is rendered only once the disclosure has been
          opened (onToggle), and its module is imported lazily at that moment. */}
      <details
        className="group [&[open]_.chev]:rotate-180"
        onToggle={(event) => { if (event.currentTarget.open) setAnalyticsOpened(true); }}
      >
        <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg border border-border bg-card px-4 py-3 text-[12px] font-semibold uppercase tracking-[0.15em] text-muted-foreground hover:text-foreground">
          <LineChartIcon className="h-3.5 w-3.5" />
          Trend and policy status
          <ChevronDown className="chev ml-auto h-4 w-4 transition-transform" />
        </summary>
        <div className="mt-3">
          {analyticsOpened ? (
            <Suspense fallback={<QueryState status="loading" label="trend and policy status" />}>
              <QueryState
                {...homeState}
                compact
                label="trend and policy status"
                onRetry={() => void refetch()}
                asOf={home.dataUpdatedAt}
                title="No trend or policy status for this window"
                body="The secured source returned nothing to show."
              >
                {data ? <HomeAnalyticsPanel trend={data.trend} lifetime={data.lifetime} policyStatus={data.policy_status} /> : null}
              </QueryState>
            </Suspense>
          ) : null}
        </div>
      </details>
        </TabsContent>
      </Tabs>
    </div>
  );
}
