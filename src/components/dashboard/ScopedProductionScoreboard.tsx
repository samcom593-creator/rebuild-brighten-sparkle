import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Building2,
  CalendarDays,
  CircleDollarSign,
  Layers,
  RefreshCw,
  TrendingUp,
  Users,
} from "lucide-react";
import { Link } from "react-router-dom";

import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CompLevelEditor } from "@/components/dashboard/CompLevelEditor";
import { resolveBrand } from "@/config/brand";
import { scoreboardWindow, type ScoreboardPeriod } from "@/lib/scoreboardPeriod";
import { useRealtimeTable } from "@/shared/realtime/useRealtimeTable";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface Totals { ap: number; policies: number }
interface TeamTotals extends Totals { agents: number }

export interface ScoreboardAgentRow {
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
  { key: "week", label: "Week to date" },
  { key: "past_week", label: "Past 7 days" },
  { key: "month", label: "Month to date" },
  { key: "year", label: "Year to date" },
];

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

function ProvenanceChip({ value }: { value: string | null | undefined }) {
  const meta = provenanceMeta(value);
  return (
    <span
      className={
        meta.tone === "assumed"
          ? "rounded border border-amber-500/50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-600 dark:text-amber-400"
          : "rounded border border-border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
      }
    >
      {meta.label}
    </span>
  );
}

function AgencyChip({ agency }: { agency: string }) {
  const vantage = /vantage/i.test(agency);
  return (
    <Badge className="whitespace-nowrap text-[10px]" variant={vantage ? "outline" : "secondary"}>
      {vantage ? "Vantage" : BRAND.shortName}
    </Badge>
  );
}

function ScoreTile({
  icon: Icon,
  label,
  value,
  detail,
  accent,
}: {
  icon: typeof TrendingUp;
  label: string;
  value: string;
  detail: string;
  accent?: boolean;
}) {
  return (
    <div className="min-w-0 border-b border-border p-4 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
      <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        <Icon className="h-3.5 w-3.5" /> {label}
      </p>
      <p className={accent ? "mt-2 truncate text-3xl font-bold tabular-nums text-primary" : "mt-2 truncate text-3xl font-bold tabular-nums text-foreground"}>
        {value}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

export function ScopedProductionScoreboard() {
  const [period, setPeriod] = useState<ScoreboardPeriod>("day");
  const [throughDate, setThroughDate] = useState(phoenixToday);
  const window = useMemo(() => scoreboardWindow(period, throughDate), [period, throughDate]);

  const query = useQuery({
    queryKey: ["scoped-production-scoreboard", window.start, window.end],
    staleTime: 120_000,
    refetchInterval: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("scoped_production_scoreboard" as never, {
        p_start: window.start,
        p_end: window.end,
      } as never);
      if (error) throw error;
      return data as unknown as ScoreboardData;
    },
  });

  const refreshProduction = () => { void query.refetch(); };
  useRealtimeTable({ table: "deals", channelSuffix: "production-scoreboard" }, refreshProduction);
  useRealtimeTable({ table: "agentlink_book", channelSuffix: "production-scoreboard" }, refreshProduction);
  useRealtimeTable(
    { table: "production_external_daily_snapshots", channelSuffix: "production-scoreboard" },
    refreshProduction,
  );
  useRealtimeTable({ table: "agent_contract_levels", channelSuffix: "production-scoreboard" }, refreshProduction);

  const data = query.data;
  // The server returns `imo` only to admins; that is the authority for the
  // admin-only tile and the comp editor, not a client-side role guess.
  const isAdmin = Boolean(data?.imo);
  const gap = data?.earnings.external_gap_override ?? null;
  const unknownLevels = data?.comp.unknown_levels_in_scope ?? 0;
  const apexAgency = data?.reconciliation.agencies.find((row) => /apex/i.test(row.agency));
  const vantageAgency = data?.reconciliation.agencies.find((row) => /vantage/i.test(row.agency));
  const external = data?.reconciliation.external_unattributed;

  return (
    <Card className="overflow-hidden border-primary/35 bg-primary/[0.035]">
      <CardContent className="p-0">
        <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-foreground">My production scoreboard</p>
              {data?.scope_label && <Badge variant="outline">{data.scope_label}</Badge>}
              <Badge variant="secondary">Live · Phoenix</Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{window.label} · personal results and your signed-in hierarchy</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
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
            <Button
              aria-label="Refresh production scoreboard"
              className="h-9 w-9 p-0"
              disabled={query.isFetching}
              onClick={() => void query.refetch()}
              size="sm"
              variant="outline"
            >
              <RefreshCw className={query.isFetching ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            </Button>
          </div>
        </div>

        {query.isLoading ? (
          <div className="grid sm:grid-cols-3">
            {[0, 1, 2].map((item) => <Skeleton className="m-4 h-24" key={item} />)}
          </div>
        ) : query.isError ? (
          <div className="flex items-center justify-between gap-3 p-4">
            <p className="text-sm text-destructive">Live production could not load. No totals were guessed.</p>
            <Button onClick={() => void query.refetch()} size="sm" variant="outline">Retry</Button>
          </div>
        ) : !data?.has_producer_profile ? (
          <div className="p-4 text-sm text-muted-foreground">Your login is not linked to a producer profile yet. Ask an administrator to connect it before production can be attributed.</div>
        ) : (
          <>
            <div className={isAdmin ? "grid sm:grid-cols-2 lg:grid-cols-4" : "grid sm:grid-cols-3"}>
              <ScoreTile
                detail={`${policies(data.personal.policies)} you sold`}
                icon={TrendingUp}
                label="My personal production"
                value={money(data.personal.ap)}
              />
              <ScoreTile
                detail={`${policies(data.direct_team.policies)} · ${plural(data.direct_team.agents, "direct report")}`}
                icon={Users}
                label="My direct team"
                value={money(data.direct_team.ap)}
              />
              <ScoreTile
                detail={`${policies(data.recursive_team.policies)} · ${data.scope_label}`}
                icon={Layers}
                label="My team production"
                value={money(data.recursive_team.ap)}
              />
              {isAdmin && data.imo && (
                <ScoreTile
                  accent
                  detail={`${policies(data.imo.policies)} · ${plural(data.imo.agents, "roster agent")} · Vantage counted`}
                  icon={Building2}
                  label="IMO total"
                  value={money(data.imo.ap)}
                />
              )}
            </div>

            <div className="grid border-t border-border lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
              <div className="border-b border-border p-4 lg:border-b-0 lg:border-r">
                <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  <CircleDollarSign className="h-3.5 w-3.5" /> My estimated earnings
                </p>
                <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <p className="text-3xl font-bold tabular-nums text-primary">{money(data.earnings.estimated)}</p>
                  <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                    Your comp {pct(data.comp.viewer_pct)} <ProvenanceChip value={data.comp.provenance} />
                  </span>
                </div>
                <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                  <dt className="text-muted-foreground">Direct</dt>
                  <dd className="tabular-nums text-foreground">{money(data.earnings.direct)} on your own policies</dd>
                  <dt className="text-muted-foreground">Override</dt>
                  <dd className="tabular-nums text-foreground">{money(data.earnings.override)} layered through your first hop</dd>
                  {isAdmin && gap && gap.policies > 0 && (
                    <>
                      <dt className="text-muted-foreground">External gap</dt>
                      <dd className="tabular-nums text-foreground">
                        {money(gap.est)} on {money(gap.ap)} {gap.agency} unattributed at {pct(gap.override_pct)}{" "}
                        <span className="text-muted-foreground">(estimated at agency head {gap.agency_head_name} {pct(gap.agency_head_pct)})</span>
                      </dd>
                    </>
                  )}
                </dl>
                {unknownLevels > 0 && (
                  <p className="mt-3 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-700 dark:text-amber-300">
                    Partial estimate: {unknownLevels} comp {unknownLevels === 1 ? "level" : "levels"} unknown, assumed {pct(data.comp.fallback_pct)}.
                  </p>
                )}
                <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">{data.earnings.basis}</p>
              </div>

              <div className="p-4">
                <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  <Building2 className="h-3.5 w-3.5" /> Agency split
                </p>
                <dl className="mt-2 space-y-1.5 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-muted-foreground">{BRAND.legalName}</dt>
                    <dd className="tabular-nums text-foreground">
                      {money(apexAgency?.ap ?? 0)} <span className="text-xs text-muted-foreground">· {policies(apexAgency?.policies ?? 0)}</span>
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-muted-foreground">Vantage Financial</dt>
                    <dd className="tabular-nums text-foreground">
                      {money(vantageAgency?.ap ?? 0)} <span className="text-xs text-muted-foreground">· {policies(vantageAgency?.policies ?? 0)}</span>
                    </dd>
                  </div>
                  {external && external.policies > 0 && (
                    <div className="flex items-center justify-between gap-3 border-t border-border pt-1.5">
                      <dt className="text-amber-700 dark:text-amber-300">External unattributed</dt>
                      <dd className="tabular-nums text-foreground">
                        {money(external.ap)} <span className="text-xs text-muted-foreground">· {policies(external.policies)} pending sync</span>
                      </dd>
                    </div>
                  )}
                </dl>
                {data.reconciliation.duplicate_candidate_groups > 0 && (
                  <p className="mt-3 text-xs text-amber-700 dark:text-amber-300">
                    {data.reconciliation.duplicate_candidate_groups} possible duplicate {data.reconciliation.duplicate_candidate_groups === 1 ? "group" : "groups"} in this window
                  </p>
                )}
              </div>
            </div>

            <div className="border-t border-border">
              <div className="flex items-center justify-between px-4 pt-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Who sold</p>
                <p className="text-xs text-muted-foreground">{data.by_agent.length} of {data.all_members_count.toLocaleString()} in scope produced</p>
              </div>
              {data.by_agent.length === 0 ? (
                <p className="px-4 pb-4 pt-2 text-sm text-muted-foreground">No policies posted in this window</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Agent</TableHead>
                        <TableHead>Agency</TableHead>
                        <TableHead className="text-right">Policies</TableHead>
                        <TableHead className="text-right">AP</TableHead>
                        <TableHead>Seller comp</TableHead>
                        <TableHead className="text-right">Your override</TableHead>
                        <TableHead className="text-right">Est. override</TableHead>
                        <TableHead>Last sale</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.by_agent.map((row) => (
                        <TableRow data-testid="who-sold-row" key={row.agent_id}>
                          <TableCell className="whitespace-nowrap font-medium text-foreground">
                            {row.name}
                            {row.is_self && <span className="ml-1.5 text-[10px] uppercase tracking-wide text-primary">you</span>}
                          </TableCell>
                          <TableCell><AgencyChip agency={row.agency} /></TableCell>
                          <TableCell className="text-right tabular-nums">{row.policies.toLocaleString()}</TableCell>
                          <TableCell className="text-right tabular-nums">{money(row.ap)}</TableCell>
                          <TableCell>
                            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                              <span className="tabular-nums">{pct(row.seller_pct)}</span>
                              <ProvenanceChip value={row.seller_pct_provenance} />
                              {isAdmin && (
                                <CompLevelEditor
                                  agentId={row.agent_id}
                                  agentName={row.name}
                                  currentPct={row.seller_pct}
                                  provenance={row.seller_pct_provenance}
                                />
                              )}
                            </span>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {pct(row.override_pct_for_viewer)}
                            {row.is_self ? (
                              <span className="ml-1 text-[10px] text-muted-foreground">direct</span>
                            ) : row.first_hop_name && row.first_hop_id !== row.agent_id ? (
                              <span className="ml-1 whitespace-nowrap text-[10px] text-muted-foreground">via {row.first_hop_name} {pct(row.first_hop_pct)}</span>
                            ) : null}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-foreground">{money(row.est_override)}</TableCell>
                          <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{row.last_sale_date ?? "—"}</TableCell>
                        </TableRow>
                      ))}
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
              Team estimated gross commission: <strong className="font-semibold text-foreground">{money(data.earnings.team_estimated)}</strong>
            </span>
            <Link className="inline-flex items-center gap-1 font-semibold text-primary hover:underline" to="/dashboard/finances">
              Commission breakdown <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
