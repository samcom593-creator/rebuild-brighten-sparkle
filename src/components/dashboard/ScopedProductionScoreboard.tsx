import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useProductionRealtime } from "@/hooks/useProductionRealtime";
import {
  ArrowRight,
  Building2,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  Eye,
  EyeOff,
  Layers,
  RefreshCw,
  Sparkles,
  TrendingUp,
  Users,
} from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { KPIStat } from "@/components/ui/kpi-stat";
import { QueryState, describeQuery } from "@/components/ui/query-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/hooks/useAuth";
import { useBusinessToday } from "@/hooks/useBusinessToday";
import { useDemoNumberFields } from "@/hooks/useDemoNumberFields";
import { applyProjectionDemo, applyScoreboardDemo, projectionDemoFields, scoreboardDemoFields, scoreboardPlacementDemo, type ScoreboardPlacementDemo } from "@/lib/productionDemoModels";
import { resolveBrand } from "@/config/brand";
import { scoreboardWindow, type ScoreboardPeriod } from "@/lib/scoreboardPeriod";
import { productionRunRate } from "@/lib/productionRunRate";
import { CarrierPolicyCohortCard } from "@/components/dashboard/CarrierPolicyCohortCard";
import { suppressDealCelebrations } from "@/lib/dealCelebrations";
import { useRealtimeTable } from "@/shared/realtime/useRealtimeTable";
import { EarningsMixChart, MonthPaceChart, ProductionMixChart } from "@/components/dashboard/ProductionVisuals";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface Totals { ap: number; policies: number }
// agents = everyone ever placed under this node (historical graph size);
// agents_current = canonical, non-placeholder, not deactivated, not terminated people today.
interface TeamTotals extends Totals { agents: number; agents_current?: number }

interface ProjectionMetric {
  label: string;
  mtd_ap: number;
  policies: number;
  active_days: number;
  projected_ap: number | null;
  completed_ap?: number;
  completed_active_days?: number;
  confidence: "low" | "medium" | "high";
}

interface ProductionProjection {
  as_of: string;
  month_start: string;
  month_end_exclusive: string;
  elapsed_calendar_days: number;
  completed_calendar_days?: number;
  method?: string;
  team_includes_personal?: boolean;
  days_in_month: number;
  has_producer_profile: boolean;
  scope_label: string;
  personal: ProjectionMetric;
  team: ProjectionMetric;
  imo: ProjectionMetric | null;
  agencies: Array<ProjectionMetric & { agency: string }>;
  basis: string;
}

export interface ScoreboardAgentRow {
  /** Vantage's owner-reported production: no attributed seller, so comp fields are null. Never editable. */
  external?: boolean;
  agent_id: string;
  name: string;
  agency: string;
  policies: number;
  ap: number;
  seller_pct: number;
  seller_pct_provenance: string;
  override_pct_for_viewer: number;
  est_override: number;
  is_self: boolean;
  first_hop_id: string | null;
  first_hop_name: string | null;
  first_hop_pct: number | null;
  first_hop_pct_provenance: string | null;
  last_sale_date: string | null;
}

interface ExternalGapOverride {
  policies: number;
  ap: number;
  agency: string;
  agency_head_name: string;
  agency_head_pct: number;
  agency_head_pct_provenance: string;
  override_pct: number | null;
  est: number | null;
  basis: string;
}

export interface ScoreboardData {
  as_of: string;
  window: { start: string; end_exclusive: string };
  has_producer_profile: boolean;
  scope_label: string;
  downline_agents: number;
  all_members_count: number;
  personal: Totals;
  direct_team: TeamTotals;
  recursive_team: TeamTotals;
  /** Named recursive descendants only; never personal or an admin's unrelated agency scope. */
  downline_only?: TeamTotals;
  /** Compatibility alias: same numbers as recursive_team. */
  team: Totals;
  /** Admin only; null for everyone else. */
  imo: TeamTotals | null;
  comp: {
    viewer_pct: number;
    provenance: string;
    unknown_levels_in_scope: number;
    fallback_pct: number;
    basis: string;
  };
  earnings: {
    estimated: number;
    direct: number;
    override: number;
    team_estimated: number;
    basis: string;
    external_gap_override: ExternalGapOverride | null;
  };
  by_agent: ScoreboardAgentRow[];
  reconciliation: {
    sources: Array<{ origin: string; policies: number; ap: number }>;
    agencies: Array<{ agency: string; policies: number; ap: number }>;
    external_unattributed: Totals;
    duplicate_candidate_groups: number;
    hierarchy_ambiguities: number;
    /** Producers with no hierarchy path to the viewer — override is 0 by construction. */
    unlinked_producers?: number;
    unlinked_ap?: number;
  };
  last_synced_at: string | null;
  source: string;
}

const PHOENIX_TZ = "America/Phoenix";
const BRAND = resolveBrand();
const isoDate = (date: Date) => date.toLocaleDateString("en-CA", { timeZone: PHOENIX_TZ });
const phoenixToday = () => isoDate(new Date());
const PERIODS: Array<{ key: ScoreboardPeriod; label: string }> = [
  { key: "day", label: "Day" },
  { key: "yesterday", label: "Yesterday" },
  { key: "week", label: "Week to date" },
  { key: "past_week", label: "Past 7 days" },
  { key: "past_30", label: "Past 30 days" },
  { key: "month", label: "Month to date" },
  { key: "last_month", label: "Last month" },
  { key: "year", label: "Year to date" },
];

// MP-372: what the book last saw, scoped exactly like the boards. Rendered
// whenever a window is empty so a fresh month (nothing posted yet on the 1st
// or 2nd) never reads as "the numbers are gone" — Sam switched periods on
// Sept 2, every to-date window was honestly $0, and the page gave him no
// context at all.
interface BookFreshness {
  last_posted_date: string | null;
  last_posted_count: number;
  last_posted_ap: number;
  last_synced_at: string | null;
  live_policies: number;
}

const money = (value: number | null | undefined) => new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
}).format(Number(value ?? 0));

const pct = (value: number | null | undefined) => {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  const n = Number(value);
  return `${Number.isInteger(n) ? n : n.toFixed(1)}%`;
};

const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? "" : word.endsWith("y") ? "" : "s"}`;
const policies = (n: number) => `${n.toLocaleString()} ${n === 1 ? "policy" : "policies"}`;

/** Source does not supply verified issued/paid totals. Optional demo inputs
 * remain visibly labeled, with no values or denominator leaked in Present mode. */
export function ScoreboardIssuePaidStrip({ metrics, hidden = false }: { metrics: ScoreboardPlacementDemo; hidden?: boolean }) {
  const shown = (value: number | null, format: (n: number) => string) => hidden ? "Hidden" : value === null ? "Unavailable" : format(value);
  return (
    <section aria-label="Issued and paid placement" className="space-y-3 border-t border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="dashboard-board-title">Issued &amp; paid / placement</h3>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">{metrics.scope} {metrics.isDemo ? "demo cohort" : "scope"} · selected dates</span>
          {metrics.isDemo && <Badge variant="outline" role="status">Demo figures</Badge>}
        </div>
      </div>
      <dl className="grid gap-3 sm:grid-cols-3">
        <div className="min-w-0 rounded-lg border border-border bg-card p-3"><dt className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Issued &amp; paid AP</dt><dd className="mt-2 break-words text-2xl font-black italic tabular-nums">{shown(metrics.issuedPaidAP, money)}</dd></div>
        <div className="min-w-0 rounded-lg border border-border bg-card p-3"><dt className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Issued &amp; paid policies</dt><dd className="mt-2 break-words text-2xl font-black italic tabular-nums">{shown(metrics.issuedPaidPolicies, value => value.toLocaleString())}</dd></div>
        <div className="min-w-0 rounded-lg border border-border bg-card p-3"><dt className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Placement</dt><dd className="mt-2 break-words text-2xl font-black italic tabular-nums">{shown(metrics.placementPct, pct)}</dd></div>
      </dl>
      <p className="text-sm text-muted-foreground">{metrics.isDemo
        ? hidden ? "Demonstration figures and submission denominator are hidden."
          : `Demonstration only. ${metrics.issuedPaidPolicies === null ? "Issued-and-paid policy count is unknown" : `${metrics.issuedPaidPolicies.toLocaleString()} issued-and-paid policies`} ÷ ${metrics.submittedPolicies?.toLocaleString() ?? "unknown"} displayed cohort policies, treated as submitted for this demo. Blank values stay unknown; a zero denominator has no placement rate.`
        : "Verified issued-and-paid receipts and a matching submission cohort are not available from this production source."}</p>
    </section>
  );
}
// MP-372: freshness line formatters. Dates are business dates (no tz shift);
// the sync instant is shown on the Phoenix clock the rest of the card uses.
const shortDate = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const shortTime = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: PHOENIX_TZ });

// Provenance chips. Amber means "this number is an assumption", never "bad".
const PROVENANCE: Record<string, { label: string; tone: "solid" | "assumed" }> = {
  carrier_avg: { label: "carrier avg", tone: "solid" },
  account: { label: "account", tone: "solid" },
  admin_ui: { label: "set by admin", tone: "solid" },
  imo_top_assumed: { label: "assumed", tone: "assumed" },
  unknown: { label: "unknown", tone: "assumed" },
};

function provenanceMeta(value: string | null | undefined) {
  if (!value) return { label: "unknown", tone: "assumed" as const };
  if (PROVENANCE[value]) return PROVENANCE[value];
  if (value.startsWith("sam_directive")) return { label: "directive", tone: "solid" as const };
  return { label: value.replace(/_/g, " "), tone: "solid" as const };
}


/**
 * Present mode (Sam, 2026-09-24): "a lot of people look at my numbers" — he screenshots the
 * scoreboard to post production without leaking client/agent names or the dollar figures he
 * doesn't want public. `on` blurs the wrapped content; a click reveals just that item so he can
 * still read it himself. Section eye-buttons and the global Present toggle drive `on`.
 */
function Reveal({ on, children, className }: { on: boolean; children: ReactNode; className?: string }) {
  const [shown, setShown] = useState(false);
  if (!on || shown) {
    return (
      <span
        className={cn(on && "cursor-pointer rounded-sm ring-1 ring-inset ring-primary/30", className)}
        onClick={on ? () => setShown(false) : undefined}
        title={on ? "Click to hide again" : undefined}
      >
        {children}
      </span>
    );
  }
  return (
    <span
      role="button"
      tabIndex={0}
      title="Hidden for posting — click to reveal"
      onClick={() => setShown(true)}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setShown(true)}
      className={cn("inline-flex cursor-pointer select-none rounded-sm bg-muted/60 align-middle blur-[6px] transition hover:blur-[4px]", className)}
    >
      {children}
    </span>
  );
}

/** Small per-section blur toggle so Sam can hide one block (names / projection / split) at a time. */
function SectionEye({ on, onToggle, label }: { on: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={on}
      title={on ? `Show ${label}` : `Blur ${label} for posting`}
      className={cn(
        "inline-flex h-6 w-6 items-center justify-center rounded-md border transition",
        on ? "border-primary/50 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground",
      )}
    >
      {on ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
    </button>
  );
}

function AgencyChip({ agency }: { agency: string }) {
  const vantage = /vantage/i.test(agency);
  return (
    <Badge className="whitespace-nowrap text-[11px]" variant={vantage ? "outline" : "secondary"}>
      {vantage ? "Vantage" : BRAND.shortName}
    </Badge>
  );
}

/**
 * Lets a page own the scoreboard's date bar so every production block on it reads
 * the same window (Galaxy map, Home gate: "one scope/date bar governs related
 * production widgets"). Home passes it; every other mount keeps its own state.
 */
export interface ScoreboardDateControl {
  period: ScoreboardPeriod;
  throughDate: string;
  onPeriodChange: (period: ScoreboardPeriod) => void;
  onThroughDateChange: (throughDate: string) => void;
  /** First day of a "custom" window (MP-302). Only a page that owns the date bar sets it. */
  customStart?: string | null;
  /** The page draws its own date bar above; the scoreboard shows the dates and no second picker. */
  hideControls?: boolean;
}

/** Canonical first-hop identity keeps separate teams distinct even when their names match. */
export function groupScoreboardAgents(rows: ScoreboardAgentRow[]) {
  const groups = new Map<string, { id: string; label: string; rows: ScoreboardAgentRow[]; policies: number; ap: number; est: number }>();
  for (const row of rows) {
    const vantage = /vantage/i.test(row.agency);
    const firstHop = row.first_hop_name && row.first_hop_id && row.first_hop_id !== row.agent_id && !row.is_self;
    const id = vantage ? "agency:vantage" : firstHop ? `hierarchy:${row.first_hop_id}` : "agency:direct";
    const label = vantage ? "Vantage Financial" : firstHop ? row.first_hop_name! : `${BRAND.shortName} — direct`;
    const group = groups.get(id) ?? { id, label, rows: [], policies: 0, ap: 0, est: 0 };
    group.rows.push(row);
    group.policies += row.policies;
    group.ap += row.ap;
    group.est += row.est_override;
    groups.set(id, group);
  }
  return Array.from(groups.values()).sort((a, b) => b.ap - a.ap || a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
}

export function ScopedProductionScoreboard({ control }: { control?: ScoreboardDateControl } = {}) {
  const { user, isManager } = useAuth();
  // Default to month-to-date, not "day". The board / leaderboard on the same
  // page show MTD, so a "day" default made this card read ~$0 while KJ's team's
  // monthly deals sat right below it on the board — the recurring "my dashboard
  // shows none of the deals" report. Both headline surfaces now open on the same
  // period. (Sam can still switch to Day/Week/Year.)
  const [ownPeriod, setOwnPeriod] = useState<ScoreboardPeriod>("month");
  // Own date (pages that do not pass a control): follows the Phoenix business day until a
  // date is picked, so a tab left open overnight does not keep showing yesterday.
  const businessToday = useBusinessToday(PHOENIX_TZ);
  const [pickedThroughDate, setPickedThroughDate] = useState<string | null>(null);
  const ownThroughDate = pickedThroughDate ?? businessToday;
  const setOwnThroughDate = (d: string) => setPickedThroughDate(d === businessToday ? null : d);
  const period = control?.period ?? ownPeriod;
  const setPeriod = control?.onPeriodChange ?? setOwnPeriod;
  const throughDate = control?.throughDate ?? ownThroughDate;
  const setThroughDate = control?.onThroughDateChange ?? setOwnThroughDate;
  // Present mode: blur the things Sam doesn't post (names / projection / agency split / earnings).
  const [blur, setBlur] = useState({ names: false, projection: false, split: false, earnings: false, comp: false });
  const presenting = blur.names && blur.projection && blur.split && blur.earnings && blur.comp;
  useEffect(() => {
    if (presenting) return suppressDealCelebrations();
  }, [presenting]);
  const toggleAll = () => {
    const next = !presenting;
    setBlur({ names: next, projection: next, split: next, earnings: next, comp: next });
  };
  const toggleBlur = (key: keyof typeof blur) => setBlur((b) => ({ ...b, [key]: !b[key] }));
  // Collapsible agency groups in the who-sold table (Apex / Vantage / sub-agency heads).
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const customStart = control?.customStart ?? null;
  const window = useMemo(() => scoreboardWindow(period, throughDate, customStart), [period, throughDate, customStart]);

  const query = useQuery({
    queryKey: ["scoped-production-scoreboard", window.start, window.end, user?.id],
    enabled: Boolean(user?.id),
    staleTime: 120_000,
    // No refetchInterval. MEASURED: scoped_production_scoreboard was the single
    // most expensive call on the platform — 18,739 calls averaging 2,155ms, or
    // 11.2 HOURS of database time. Across ~65 active agents that is ~288 calls
    // each, which is what a 5-minute poll on an all-day dashboard produces.
    //
    // Polling was also the SLOWER way to be correct: it left the board stale
    // for up to 5 minutes after a deal posted. This surface now refreshes from
    // the realtime channel the moment deals/daily_production/agents change, so
    // it is both fresher and dramatically cheaper.
    refetchOnWindowFocus: false,
    retry: 1,
    retryDelay: 4_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("scoped_production_scoreboard" as never, {
        p_start: window.start,
        p_end: window.end,
      } as never);
      if (error) throw error;
      return data as unknown as ScoreboardData;
    },
  });

  const projection = useQuery({
    queryKey: ["scoped-production-projection", user?.id, businessToday],
    enabled: Boolean(user?.id),
    staleTime: 120_000,
    refetchOnWindowFocus: false,
    retry: 1,
    retryDelay: 4_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("scoped_production_projection" as never);
      if (error) throw error;
      return data as unknown as ProductionProjection;
    },
  });

  // MP-372: only fetched when the selected window is empty. One cheap scoped
  // read, never polled — it refetches with the board via the same realtime
  // invalidation below.
  const windowIsEmpty = Boolean(query.data && query.data.by_agent.length === 0);
  // Discord ingestion health is separate from the Vantage production API.
  // MP-394. The legacy reader of the Discord chat was credential-blocked;
  // and the reader of that chat had no credential from 2026-07-29 with nothing
  // on any surface saying so. This is the RPC's verdict, never a client guess.
  const feed = useQuery({
    queryKey: ["discord-deal-feed-health", user?.id],
    enabled: Boolean(user?.id),
    staleTime: 300_000,
    retry: 1,
    retryDelay: 4_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("discord_deal_feed_health" as never);
      if (error) throw error;
      return ((data ?? []) as unknown) as Array<{
        source: string; agency_name: string; status: string; detail: string | null;
        last_ingested_at: string | null; last_heartbeat_at: string | null;
      }>;
    },
  });
  const blockedFeeds = (feed.data ?? []).filter((f) => f.status !== "healthy");
  const blockedFeedAgencies = blockedFeeds.map((f) => f.agency_name).join(", ");
  const blockedFeedsMissingIngestTimestamp = blockedFeeds.every((f) => !f.last_ingested_at);

  const freshness = useQuery({
    queryKey: ["production-book-freshness", user?.id],
    enabled: windowIsEmpty && Boolean(user?.id),
    staleTime: 120_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("production_book_freshness" as never);
      if (error) throw error;
      const value: unknown = data;
      const row = (Array.isArray(value) ? value[0] : value) as BookFreshness | null | undefined;
      return row ?? null;
    },
  });

  // Refresh from the realtime channel instead of polling. See the comment on
  // refetchInterval above: the poll cost 11.2 hours of database time and was
  // still up to 5 minutes stale after a deal posted.
  const refreshProduction = () => {
    // MP-431: never cancel an in-flight heavy call on a realtime flush — the
    // database keeps executing the abandoned statement. Dedupe onto it instead.
    void query.refetch({ cancelRefetch: false });
    void projection.refetch({ cancelRefetch: false });
    void feed.refetch({ cancelRefetch: false });
    // The freshness line only exists while the window is empty; a posted deal
    // may fill the window (query above) or move "last posted" (this one).
    if (windowIsEmpty) void freshness.refetch();
  };
  useProductionRealtime(refreshProduction, 800);
  // The board reads the production snapshot (mv_production_comp_truth), which refreshes on a
  // 5-minute job after a 15 s debounce, so a deal shows in Total IMO by agency (live) first and the
  // board only caught up on the next unrelated event. truth_refresh_state's 'production' row flips
  // to dirty=false when the snapshot lands: refetch the board then. A dirty-mark (deal written,
  // snapshot not refreshed yet) is ignored, because refetching then would read the old snapshot.
  useRealtimeTable<{ name: string; dirty: boolean }>(
    { table: "truth_refresh_state", event: "UPDATE", filter: "name=eq.production", channelSuffix: "scoreboard-truth" },
    (payload) => {
      if (payload.new && payload.new.dirty === false) void query.refetch({ cancelRefetch: false });
    },
  );
  // MP-361. Three raw subscriptions were REMOVED here — deals,
  // production_external_deals and production_external_daily_snapshots — because
  // useProductionRealtime() above already watches all three and delivers them
  // through an 800ms debounce. Every `deals` row event was therefore refetching
  // this RPC TWICE: once debounced, and once immediately. The immediate leg is
  // the expensive one: the comment on refetchInterval above measures
  // scoped_production_scoreboard at 2,155ms average, and `deals` is written in
  // bursts of 11 rows per second, so one burst fired 11 undebounced refetches
  // of the most expensive call on the platform. That is the same starvation
  // that timed out 195 of 269 reads of v_imo_by_agency at 57014 and took the
  // public landing_* RPCs down with it.
  //
  // The two kept below are NOT covered by useProductionRealtime. Both are also
  // absent from the supabase_realtime publication today (checked live via
  // pg_publication_tables), so neither has ever fired — they are coalesced
  // rather than deleted so that adding either to the publication cannot
  // reopen this class.
  useRealtimeTable(
    { table: "agentlink_book", channelSuffix: "production-scoreboard", coalesceMs: 750 },
    refreshProduction,
  );
  useRealtimeTable(
    { table: "agent_contract_levels", channelSuffix: "production-scoreboard", coalesceMs: 750 },
    refreshProduction,
  );

  const productionDemo = useDemoNumberFields({
    scopeKey: `scoreboard:${query.data?.imo ? "imo" : "personal"}:${window.start}:${window.end}`,
    label: `Production · ${window.label}`,
    fields: scoreboardDemoFields(query.data),
  });
  const projectionDemo = useDemoNumberFields({
    scopeKey: `projection:${projection.data?.imo ? "imo" : "personal"}:${projection.data?.month_start ?? "pending"}:${projection.data?.month_end_exclusive ?? "pending"}`,
    label: "Current month · projections",
    fields: projectionDemoFields(projection.data),
  });
  const data = productionDemo.isDemo ? applyScoreboardDemo(query.data, productionDemo.values) : query.data;
  const issuePaidMetrics = scoreboardPlacementDemo(data, productionDemo.values, productionDemo.isDemo);
  const projectionData = projectionDemo.isDemo ? applyProjectionDemo(projection.data, projectionDemo.values) : projection.data;
  // The server returns `imo` only to admins; that is the authority for the
  // admin-only tile, not a client-side role guess.
  const isAdmin = Boolean(data?.imo);
  // MP-335: comp level is no longer admin-only. A manager may set a level for
  // their own downline, so the editor renders for them too. This is presentation
  // only — set_agent_contract_pct is the authority and independently refuses a
  // target outside the caller's downline, the caller's own row, and any value
  // above the caller's own level. Showing a control the server would refuse is
  // a worse failure than hiding one it would allow, so `is_self` is excluded
  // here as well rather than relying on the round trip to say no.
  const unknownLevels = data?.comp.unknown_levels_in_scope ?? 0;

  // Group the who-sold rows by hierarchy so Sam can collapse/expand each sub-agency (Sam 2026-09-24:
  // "separate Vantage, Apex, and whoever has a hierarchy — OB, Judy — make it collapsible"). Vantage is
  // its own group; everyone else groups under the sub-agency head who sits one hop below Sam; Sam's own
  // direct sellers group under "<Brand> — direct". Sorted by AP so the biggest agency leads.
  const agentGroups = useMemo(() => groupScoreboardAgents(data?.by_agent ?? []), [data]);

  return (
    <Card className="dashboard-production overflow-hidden border-primary/35 bg-primary/[0.035]">
      <CardContent className="p-0">
        <div className="dashboard-production__header flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="dashboard-production__title text-foreground">Production</p>
              {productionDemo.isDemo && <Badge variant="outline" role="status">Demo figures</Badge>}
              {data?.scope_label && <Badge variant="outline">{data.scope_label}</Badge>}
              <Badge variant="secondary">{query.isError ? "Refresh failed" : query.isPending ? "Loading" : query.isFetching ? "Refreshing" : "Production"} · Phoenix</Badge>
            </div>
            <p className="dashboard-production__date">{window.label}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {control?.hideControls ? null : (<>
            <div className="relative">
              <CalendarDays className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
              <Input
                aria-label="Scoreboard through date"
                className="h-9 w-[150px] pl-8 text-xs"
                max={phoenixToday()}
                type="date"
                value={throughDate}
                onChange={(event) => event.target.value && setThroughDate(event.target.value)}
              />
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button className="h-9" size="sm" variant="outline">
                  {PERIODS.find((item) => item.key === period)?.label}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {PERIODS.map((item) => (
                  <DropdownMenuItem key={item.key} onSelect={() => setPeriod(item.key)}>
                    {item.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            </>)}
            <Button
              aria-label={presenting ? "Show all hidden figures" : "Blur names, projection, split and earnings for posting"}
              className={cn("h-9", presenting && "border-primary/50 bg-primary/10 text-primary")}
              onClick={toggleAll}
              size="sm"
              variant="outline"
            >
              {presenting ? <EyeOff className="mr-1.5 h-4 w-4" /> : <Eye className="mr-1.5 h-4 w-4" />}
              {presenting ? "Presenting" : "Present"}
            </Button>
            <Button
              aria-label="Refresh production scoreboard"
              className="h-9 w-9 p-0"
              disabled={query.isFetching}
              onClick={refreshProduction}
              size="sm"
              variant="outline"
            >
              <RefreshCw className={query.isFetching ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            </Button>
          </div>
        </div>

        <QueryState
          {...describeQuery(query)}
          label="production totals"
          asOf={query.dataUpdatedAt}
          onRetry={() => void query.refetch()}
          title="Production totals are unavailable"
          body="The server returned no scoreboard. Refresh to try again."
          className="p-4"
        >
        {!data?.has_producer_profile ? (
          <div className="p-4 text-sm text-muted-foreground">Your login is not linked to a producer profile yet. Ask an administrator to connect it before production can be attributed.</div>
        ) : (
          <>
            {/* One dominant total, with the overlapping scopes kept separate below it. */}
            <div className="dashboard-production__totals" data-admin={isAdmin}>
              {isAdmin && data.imo && (
                <KPIStat
                  accent
                  prominent
                  detail={`${policies(data.imo.policies)} · ${plural(data.by_agent.filter(row => !row.external).length, "producer")} in this window`}
                  icon={Building2}
                  label="IMO total"
                  tone="good"
                  unit="ALP"
                  value={money(data.imo.ap)}
                />
              )}
              <KPIStat
                detail={`${policies(data.personal.policies)} you sold`}
                icon={TrendingUp}
                label="My personal production"
                prominent={!isAdmin}
                tone="good"
                unit="ALP"
                value={money(data.personal.ap)}
              />
              <KPIStat
                detail={`${policies(data.direct_team.policies)} · ${plural(data.direct_team.agents_current ?? data.direct_team.agents, "current direct agent")}`}
                icon={Users}
                label="My direct team"
                tone="cool"
                unit="ALP"
                value={money(data.direct_team.ap)}
              />
              <KPIStat
                detail={data.downline_only ? `${policies(data.downline_only.policies)} · personal sales excluded` : "Downline scope has not been verified"}
                icon={Layers}
                label="My team production"
                tone="good"
                unit="ALP"
                value={data.downline_only ? money(data.downline_only.ap) : "Unavailable"}
              />
            </div>

            {issuePaidMetrics.isDemo && <ScoreboardIssuePaidStrip metrics={issuePaidMetrics} hidden={presenting || blur.split} />}
            <div className="border-t border-border p-4"><CarrierPolicyCohortCard start={window.start} endExclusive={window.end} hidden={presenting || blur.split} /></div>

            <div className="dashboard-production__pace border-t border-border p-4">
              <QueryState
                {...describeQuery(projection)}
                label="month-end projections"
                asOf={projection.dataUpdatedAt}
                onRetry={() => void projection.refetch({ cancelRefetch: false })}
                title="Month-end projections are unavailable"
                body="The selected-period production above is still shown."
              >
              {projectionData?.has_producer_profile && (
              <section aria-label="Month-end projections">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <p className="dashboard-board-eyebrow"><Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> Pace / current month</p>
                    <h3 className="dashboard-board-title">Month-end projections</h3>
                    {projectionDemo.isDemo && <Badge variant="outline" role="status">Demo figures</Badge>}
                    <p className="mt-1 text-xs text-muted-foreground">{projectionDemo.isDemo ? "Demo" : "Recorded"} MTD pace · Phoenix time · {projectionData.scope_label}. Current month only; separate from the selected dates above.</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <p className="text-[12px] text-muted-foreground">{projectionData.completed_calendar_days ?? "—"} completed days of {projectionData.days_in_month}</p>
                    <SectionEye on={blur.projection} onToggle={() => toggleBlur("projection")} label="projection" />
                  </div>
                </div>

                <div className={projectionData.imo ? "mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3" : "mt-4 grid gap-3 sm:grid-cols-2"}>
                  {[
                    { key: "personal", label: "My projected production", metric: projectionData.personal },
                    { key: "team", label: "My team projected", metric: projectionData.team },
                    ...(projectionData.imo ? [{ key: "imo", label: "Full IMO projected", metric: projectionData.imo }] : []),
                  ].map(({ key, label, metric }) => {
                    const runRate = productionRunRate(metric, projectionData.completed_calendar_days, projectionData.days_in_month);
                    return (
                    <div className="dashboard-pace-card min-w-0 rounded-lg border border-border/70 bg-card p-3" key={key}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
                        <Badge variant="outline">{runRate.amount === null ? "Insufficient sample" : "Run-rate estimate"}</Badge>
                      </div>
                      <p className="dashboard-pace-card__value mt-3"><Reveal on={blur.projection}>{runRate.amount === null ? "Unavailable" : money(runRate.amount)}</Reveal></p>
                      <p className="mt-1 text-xs text-muted-foreground">MTD <Reveal on={blur.projection}>{money(metric.mtd_ap)} · {policies(metric.policies)} · {metric.active_days} days with posted production</Reveal></p>
                      <MonthPaceChart
                        actual={metric.mtd_ap}
                        projected={runRate.amount}
                        elapsedDays={projectionData.completed_calendar_days ?? 0}
                        completedAP={metric.completed_ap}
                        daysInMonth={projectionData.days_in_month}
                        hidden={blur.projection}
                      />
                      {runRate.reason && <p className="mt-2 text-xs text-muted-foreground">{runRate.reason}</p>}
                    </div>
                    );
                  })}
                </div>

                {projectionData.agencies.length > 0 && (
                  <details className="dashboard-agency-projections mt-3 rounded-lg border border-border/70 bg-card p-3">
                    <summary className="min-h-11 cursor-pointer text-sm font-semibold uppercase tracking-wide text-muted-foreground">Agency projections</summary>
                    <div className="mt-2 divide-y divide-border/70">
                      {projectionData.agencies.map((agency) => (
                        <div className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0" key={agency.agency}>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-foreground"><Reveal on={blur.names || blur.split}>{agency.agency}</Reveal></p>
                            <p className="text-[12px] text-muted-foreground">MTD <Reveal on={blur.projection}>{money(agency.mtd_ap)} · {policies(agency.policies)}</Reveal></p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="font-bold tabular-nums text-foreground"><Reveal on={blur.projection}>{(() => { const amount = productionRunRate(agency, projectionData.completed_calendar_days, projectionData.days_in_month).amount; return amount === null ? "Unavailable" : money(amount); })()}</Reveal></p>
                            <p className="text-[13px] uppercase text-muted-foreground">arithmetic run rate</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </details>
                )}

                <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">{projectionData.basis}</p>
              </section>
              )}
              </QueryState>
            </div>

            <div className="grid border-t border-border lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
              <div className="border-b border-border p-4 lg:border-b-0 lg:border-r">
                <div className="flex items-center justify-between gap-2">
                  <p className="dashboard-board-eyebrow">
                    <CircleDollarSign className="h-3.5 w-3.5" /> My estimated earnings
                  </p>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">$</span>
                    <SectionEye on={blur.earnings} onToggle={() => toggleBlur("earnings")} label="earnings" />
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <p className="dashboard-earnings-value"><Reveal on={blur.earnings}>{money(data.earnings.estimated)}</Reveal></p>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">Selected dates · estimated gross commission, not paid cash</p>
                <EarningsMixChart direct={data.earnings.direct} override={data.earnings.override} externalOverride={data.earnings.external_gap_override ? data.earnings.external_gap_override.est ?? null : 0} hidden={blur.earnings} />
                <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                  <dt className="text-muted-foreground">Direct</dt>
                  <dd className="tabular-nums text-foreground"><Reveal on={blur.earnings}>{money(data.earnings.direct)}</Reveal> on your own policies</dd>
                  <dt className="text-muted-foreground">Override</dt>
                  <dd className="tabular-nums text-foreground"><Reveal on={blur.earnings}>{money(data.earnings.override)}</Reveal> layered through your first hop</dd>
                  {data.earnings.external_gap_override && <>
                    <dt className="text-muted-foreground">External agency</dt>
                    <dd className="tabular-nums text-foreground"><Reveal on={blur.earnings}>{data.earnings.external_gap_override.est != null && Number.isFinite(data.earnings.external_gap_override.est) ? money(data.earnings.external_gap_override.est) : "—"}</Reveal> estimated override</dd>
                  </>}
                </dl>
                {unknownLevels > 0 && (
                  <p className="mt-3 text-xs text-muted-foreground">
                    Partial estimate: {unknownLevels} comp {unknownLevels === 1 ? "level" : "levels"} unknown, assumed {pct(data.comp.fallback_pct)}.
                  </p>
                )}
                {(data.reconciliation.unlinked_producers ?? 0) > 0 && (
                  <p className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-2 text-xs text-foreground">
                    {data.reconciliation.unlinked_producers} producing {data.reconciliation.unlinked_producers === 1 ? "agent has" : "agents have"} no manager path to you —{" "}
                    {money(data.reconciliation.unlinked_ap ?? 0)} of production is earning you 0% override. Set their manager in the roster.
                  </p>
                )}
                <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">{data.earnings.basis}</p>
              </div>

              <div className="p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="dashboard-board-eyebrow">
                    <Building2 className="h-3.5 w-3.5" /> Hierarchy / production ranks
                  </p>
                  <SectionEye on={blur.split} onToggle={() => toggleBlur("split")} label="agency split" />
                </div>
                {productionDemo.isDemo && agentGroups.length === 0 && (data.imo?.ap ?? data.personal.ap) > 0
                  ? <p className="mt-4 text-sm text-muted-foreground">Demo total · no agent breakdown in this window.</p>
                  : <ProductionMixChart rows={agentGroups} hidden={blur.names || blur.split} />}
                {data.reconciliation.duplicate_candidate_groups > 0 && (
                  <p className="mt-3 text-xs text-amber-700 dark:text-amber-300">
                    {data.reconciliation.duplicate_candidate_groups} possible duplicate {data.reconciliation.duplicate_candidate_groups === 1 ? "group" : "groups"} in this window
                  </p>
                )}
              </div>
            </div>

            <div className="border-t border-border">
              {feed.isError ? (
                <div className="mx-4 mt-3 text-xs text-muted-foreground">
                  Deal-feed health could not be checked. Production posted only in Discord may be missing from this board.
                </div>
              ) : blockedFeeds.length > 0 && (
                <div className="mx-4 mt-3 text-xs text-muted-foreground">
                  <p>
                    <span className="font-medium text-foreground">
                      {blockedFeeds.length === 1
                        ? blockedFeeds[0].status === "credential_blocked"
                          ? "The Discord deal import is off: the Discord bot has no token."
                          : "The Discord deal import needs attention."
                        : `${blockedFeeds.length} Discord deal imports need attention: ${blockedFeedAgencies}.`}
                    </span>{" "}
                    {blockedFeeds.length === 1 && blockedFeeds[0].status === "credential_blocked"
                      ? ""
                      : blockedFeedsMissingIngestTimestamp
                        ? "These feeds have no verified import timestamp. "
                        : "One or more chats may be missing recent deals. "}
                    Discord-only deals may be missing. Agency totals received through the production API remain included.
                  </p>
                </div>
              )}
              <div className="flex items-center justify-between gap-2 px-4 pt-3">
                <p className="text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">Who sold · by agency</p>
                <div className="flex items-center gap-2">
                  <p className="hidden text-xs text-muted-foreground sm:block">{data.by_agent.filter(row => !row.external).length} producers · {agentGroups.length} agencies</p>
                  <SectionEye on={blur.names} onToggle={() => toggleBlur("names")} label="names" />
                </div>
              </div>
              {data.by_agent.length === 0 ? (
                <div className="px-4 pb-4 pt-2">
                  <p className="text-sm text-muted-foreground">Nothing posted in this window yet</p>
                  {freshness.data?.last_posted_date ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Last policy posted {shortDate(freshness.data.last_posted_date)}
                      {" · "}{policies(freshness.data.last_posted_count)}
                      {" · "}{money(freshness.data.last_posted_ap)}
                      {freshness.data.last_synced_at ? ` · book synced ${shortTime(freshness.data.last_synced_at)}` : ""}
                      {" · "}{freshness.data.live_policies.toLocaleString()} live in your scope
                    </p>
                  ) : freshness.isLoading ? (
                    <Skeleton className="mt-2 h-3 w-64" />
                  ) : null}
                  {period !== "last_month" && (
                    <Button className="mt-2 h-8" onClick={() => setPeriod("last_month")} size="sm" variant="outline">
                      Show last month
                    </Button>
                  )}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Agent</TableHead>
                        <TableHead>Agency</TableHead>
                        <TableHead className="text-right">Policies</TableHead>
                        <TableHead className="text-right">ALP</TableHead>
                        <TableHead className="text-right">Est. override</TableHead>
                        <TableHead>Last sale</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {agentGroups.map((group) => {
                        const collapsed = collapsedGroups[group.id];
                        return (
                        <Fragment key={group.id}>
                        <TableRow
                          className="cursor-pointer bg-muted/40 hover:bg-muted/70"
                          onClick={() => setCollapsedGroups((c) => ({ ...c, [group.id]: !c[group.id] }))}
                        >
                          <TableCell colSpan={2} className="font-semibold text-foreground">
                            <span className="inline-flex items-center gap-1.5">
                              {collapsed ? <ChevronRight className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                              <Reveal on={blur.names}>{group.label}</Reveal>
                              <span className="text-xs font-normal text-muted-foreground">· {group.rows.length}</span>
                            </span>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{group.policies.toLocaleString()}</TableCell>
                          <TableCell className="text-right font-semibold tabular-nums text-foreground">{money(group.ap)}</TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">{money(group.est)}</TableCell>
                          <TableCell />
                        </TableRow>
                        {!collapsed && group.rows.map((row) => (
                        <TableRow data-testid="who-sold-row" key={row.agent_id}>
                          <TableCell className="whitespace-nowrap pl-8 font-medium text-foreground">
                            <Reveal on={blur.names}>{row.name}</Reveal>
                            {row.is_self && <span className="ml-1.5 text-[11px] uppercase tracking-wide text-primary">you</span>}
                          </TableCell>
                          <TableCell><AgencyChip agency={row.agency} /></TableCell>
                          <TableCell className="text-right tabular-nums">{row.policies.toLocaleString()}</TableCell>
                          <TableCell className="text-right tabular-nums">{money(row.ap)}</TableCell>
                          <TableCell className="text-right tabular-nums text-foreground">{money(row.est_override)}</TableCell>
                          <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{row.last_sale_date ?? "—"}</TableCell>
                        </TableRow>
                        ))}
                        </Fragment>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </>
        )}

        {data?.has_producer_profile && (
          <div className="flex flex-col gap-2 border-t border-border px-4 py-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <span>
              Team estimated gross commission: <strong className="font-semibold text-foreground"><Reveal on={blur.earnings}>{money(data.earnings.team_estimated)}</Reveal></strong>
            </span>
            <Link className="inline-flex items-center gap-1 font-semibold text-primary hover:underline" to="/dashboard/finances">
              Commission breakdown <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        )}
        </QueryState>
      </CardContent>
    </Card>
  );
}
