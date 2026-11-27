/**
 * Commissions dashboard (MP-COMMISSIONS-REDO, 2026-11-27). The Finances > Commissions tab.
 *
 * One server call, commissions_dashboard(p_agent_id), gives the whole page: KPI tiles priced at the agent's
 * contract rate, every posted deal with the carrier portal's verdict on it (in force, pending, lost, awaiting the
 * feed, not found, no feed), twelve months of estimates, carrier chargebacks and the Ethos production snapshot.
 * Rules the page keeps: estimates are hidden, not defaulted, when the rate is not on file; a failed read is an
 * error with Retry, never an empty book; nothing shown is money received, and the footer says so.
 * Admins and managers can read another agent they are allowed to see (the server checks apex_can_read_agent).
 * The pure rules (parsing, filters, CSV, wording) live in src/lib/commissionsDashboard.ts.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, RefreshCw, Search } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { QueryState, describeQuery } from "@/components/ui/query-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  EMPTY_DEAL_FILTER, LANE_META, bookFreshnessSentence, dealsCsv, estText, filterDeals, laneStrip, money, monthLabel, monthShort,
  paidFeedSentence, parseCommissionsDashboard, rateSentence, shortDate, sumAp, sumEst,
  type CommissionsDashboardData, type DealFilter, type Lane,
} from "@/lib/commissionsDashboard";

const INITIAL_ROWS = 100;

const TONE_CLASSES: Record<(typeof LANE_META)[Lane]["tone"], string> = {
  success: "border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200",
  info: "border-cyan-500/40 bg-cyan-500/10 text-cyan-800 dark:text-cyan-200",
  muted: "border-border bg-muted/40 text-muted-foreground",
  warning: "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200",
  danger: "border-rose-500/40 bg-rose-500/10 text-rose-800 dark:text-rose-200",
};

// Theme tokens, same as the Finances management chart, so the bars follow light/dark and the Brand Bible palette.
const CHART_SERIES: Array<{ key: "est_in_force" | "est_pending" | "est_lost" | "est_unknown"; name: string; fill: string }> = [
  { key: "est_in_force", name: "In force", fill: "hsl(var(--success))" },
  { key: "est_pending", name: "Pending or awaiting feed", fill: "hsl(var(--info))" },
  { key: "est_unknown", name: "No portal verdict", fill: "hsl(var(--muted-foreground))" },
  { key: "est_lost", name: "Lapsed or not taken", fill: "hsl(var(--destructive))" },
];
const AP_FILL = "hsl(var(--primary))";

interface AgentOption { id: string; display_name: string | null }

function downloadCsv(filename: string, body: string) {
  const blob = new Blob([body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function LaneBadge({ lane }: { lane: Lane }) {
  const meta = LANE_META[lane];
  return <span title={meta.hint} className={cn("inline-flex rounded-md border px-2 py-0.5 text-xs font-semibold", TONE_CLASSES[meta.tone])}>{meta.label}</span>;
}

/** Pure presentation of a parsed payload; the data component below feeds it. */
export function CommissionsDashboardView({ data, onViewPolicies, onRefresh, refreshing }: {
  data: CommissionsDashboardData;
  onViewPolicies?: () => void;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  const [filter, setFilter] = useState<DealFilter>(EMPTY_DEAL_FILTER);
  const [visibleCount, setVisibleCount] = useState(INITIAL_ROWS);
  const rateOnFile = data.agent.rate_on_file;
  const filtered = useMemo(() => filterDeals(data.deals, filter), [data.deals, filter]);
  const strip = useMemo(() => laneStrip(data.kpis.lanes), [data.kpis.lanes]);
  const monthsWithDeals = useMemo(() => data.months.filter((m) => m.deals > 0).map((m) => m.month).reverse(), [data.months]);
  const chartRows = useMemo(() => data.months.map((m) => ({
    label: monthShort(m.month), ap: m.ap,
    est_in_force: m.est_in_force ?? 0, est_pending: m.est_pending ?? 0, est_lost: m.est_lost ?? 0, est_unknown: m.est_unknown ?? 0,
  })), [data.months]);
  const filterActive = filter.month !== null || filter.lane !== "all" || filter.search !== "";
  const setLane = (lane: Lane | "all") => { setFilter((f) => ({ ...f, lane: f.lane === lane ? "all" : lane })); setVisibleCount(INITIAL_ROWS); };
  const tiles = [
    { label: "This month", value: estText(data.kpis.mtd_est, rateOnFile), detail: `${data.kpis.mtd_deals.toLocaleString()} ${data.kpis.mtd_deals === 1 ? "deal" : "deals"} · ${money(data.kpis.mtd_ap)} premium`, color: "text-emerald-700 dark:text-emerald-300" },
    { label: "Last month", value: estText(data.kpis.last_month_est, rateOnFile), detail: `${data.kpis.last_month_deals.toLocaleString()} ${data.kpis.last_month_deals === 1 ? "deal" : "deals"}`, color: "text-cyan-700 dark:text-cyan-300" },
    { label: "Year to date", value: estText(data.kpis.ytd_est, rateOnFile), detail: `${data.kpis.ytd_deals.toLocaleString()} ${data.kpis.ytd_deals === 1 ? "deal" : "deals"} · ${money(data.kpis.ytd_ap)} premium`, color: "text-foreground" },
    { label: "Last 12 months", value: estText(data.kpis.est_12m, rateOnFile), detail: `${data.kpis.deals_12m.toLocaleString()} ${data.kpis.deals_12m === 1 ? "deal" : "deals"} · ${money(data.kpis.ap_12m)} premium`, color: "text-foreground" },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="galaxy-heading text-2xl font-bold">{data.agent.name ? `${data.agent.name}'s commissions` : "Your commissions"}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{rateSentence(data.agent)}</p>
        </div>
        {onRefresh && (
          <Button type="button" variant="outline" size="sm" onClick={onRefresh} disabled={refreshing} aria-label="Refresh commissions">
            <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} aria-hidden /> Refresh
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((tile) => (
          <div key={tile.label} className="min-w-0 rounded-xl border-2 border-border bg-card p-5">
            <p className="text-sm font-bold uppercase tracking-wide text-muted-foreground">{tile.label}</p>
            <p className={cn("galaxy-stat mt-3 break-words font-black italic tabular-nums", rateOnFile ? "text-4xl" : "text-xl not-italic", tile.color)}>{tile.value}</p>
            <p className="mt-3 text-sm text-muted-foreground">{tile.detail}</p>
          </div>
        ))}
      </div>

      <section aria-label="Where the last 12 months of deals stand with the carriers" className="space-y-2">
        <p className="text-sm font-semibold text-foreground">Where the last 12 months stand with the carriers</p>
        <div className="flex flex-wrap gap-2">
          {strip.map((item) => {
            const meta = LANE_META[item.lane];
            const pressed = filter.lane === item.lane;
            return (
              <button key={item.lane} type="button" aria-pressed={pressed} title={meta.hint} onClick={() => setLane(item.lane)}
                className={cn("min-h-11 rounded-lg border px-3 py-2 text-left text-sm transition", TONE_CLASSES[meta.tone], pressed && "ring-2 ring-foreground/60")}>
                <span className="font-bold">{meta.label}</span>
                <span className="ml-2 tabular-nums">{item.n.toLocaleString()} · {money(item.ap)} premium{rateOnFile ? ` · ${money(item.est)} est.` : ""}</span>
              </button>
            );
          })}
          {strip.length === 0 && <p className="text-sm text-muted-foreground">No deals posted in the last 12 months.</p>}
        </div>
      </section>

      {data.months.some((m) => m.deals > 0) && (
        <section className="rounded-xl border border-border bg-card p-4 sm:p-5" aria-label="Twelve months of estimated commission">
          <p className="text-sm font-semibold text-foreground">{rateOnFile ? "Estimated commission by month, split by what the carrier says now" : "Annual premium posted by month"}</p>
          <div className="mt-3 h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} tickFormatter={(v: number) => money(v)} width={72} />
                <ChartTooltip formatter={(v: number) => money(v)} />
                {rateOnFile ? (<>
                  <Legend />
                  {CHART_SERIES.map((s) => <Bar key={s.key} dataKey={s.key} name={s.name} stackId="est" fill={s.fill} />)}
                </>) : <Bar dataKey="ap" name="Annual premium" fill={AP_FILL} />}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      <section className="space-y-3 rounded-xl border border-border bg-card p-4 sm:p-5" aria-label="Deals">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="galaxy-heading text-xl font-bold">Deals</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {filtered.length.toLocaleString()} of {data.deals.length.toLocaleString()} · {money(sumAp(filtered))} premium
              {rateOnFile && filtered.length > 0 ? ` · ${money(sumEst(filtered))} estimated` : ""}
              {data.deals.length === 500 ? " · showing the newest 500" : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <label className="sr-only" htmlFor="commissions-month">Month</label>
            <select id="commissions-month" className="h-11 rounded-md border border-input bg-background px-3 text-sm" value={filter.month ?? "all"}
              onChange={(e) => { setFilter((f) => ({ ...f, month: e.target.value === "all" ? null : e.target.value })); setVisibleCount(INITIAL_ROWS); }}>
              <option value="all">Every month</option>
              {monthsWithDeals.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
            </select>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input aria-label="Search deals" placeholder="Client, carrier, policy number" className="h-11 w-64 pl-9" value={filter.search}
                onChange={(e) => { setFilter((f) => ({ ...f, search: e.target.value })); setVisibleCount(INITIAL_ROWS); }} />
            </div>
            {filterActive && <Button type="button" variant="ghost" className="h-11" onClick={() => { setFilter(EMPTY_DEAL_FILTER); setVisibleCount(INITIAL_ROWS); }}>Clear</Button>}
            <Button type="button" variant="outline" className="h-11" disabled={filtered.length === 0}
              onClick={() => downloadCsv(`commissions-${data.today}.csv`, dealsCsv(filtered, rateOnFile))}>
              <Download className="h-4 w-4" aria-hidden /> CSV
            </Button>
          </div>
        </div>
        {filtered.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            {data.deals.length === 0 ? "No deals posted in the last 13 months." : "No deals match these filters."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Posted</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Carrier · product</TableHead>
                  <TableHead>Policy</TableHead>
                  <TableHead className="text-right">Premium</TableHead>
                  {rateOnFile && <TableHead className="text-right">Estimated</TableHead>}
                  <TableHead>Carrier says</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.slice(0, visibleCount).map((d) => (
                  <TableRow key={d.row_key}>
                    <TableCell className="whitespace-nowrap tabular-nums">{shortDate(d.posted_date) || "No date"}</TableCell>
                    <TableCell className="font-medium">{d.client_name || "No name on the deal"}</TableCell>
                    <TableCell>{[d.carrier, d.product].filter(Boolean).join(" · ") || "Not recorded"}</TableCell>
                    <TableCell className="font-mono text-xs">{d.policy_number || "None"}</TableCell>
                    <TableCell className="text-right tabular-nums">{d.annual_premium === null ? "Not recorded" : money(d.annual_premium)}</TableCell>
                    {rateOnFile && <TableCell className="text-right tabular-nums">{d.est === null ? "Not recorded" : money(d.est)}</TableCell>}
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <LaneBadge lane={d.lane} />
                        {(d.status_raw || d.issued_on || d.lost_on) && (
                          <span className="text-xs text-muted-foreground">
                            {d.status_raw}{d.issued_on ? ` · issued ${shortDate(d.issued_on)}` : ""}{d.lost_on ? ` · lost ${shortDate(d.lost_on)}` : ""}{d.close_reason ? ` · ${d.close_reason}` : ""}
                          </span>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {filtered.length > visibleCount && (
              <Button type="button" variant="outline" className="mt-3" onClick={() => setVisibleCount(filtered.length)}>Show all {filtered.length.toLocaleString()} deals</Button>
            )}
          </div>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-border bg-card p-4 sm:p-5" aria-label="Carrier chargebacks">
          <p className="text-sm font-bold text-muted-foreground">Carrier-recorded chargebacks</p>
          <p className="galaxy-stat mt-3 text-3xl font-black tabular-nums text-rose-700 dark:text-rose-300">{data.chargebacks.length ? money(data.chargeback_open_total, 2) : "None recorded"}</p>
          <p className="mt-2 text-sm text-muted-foreground">{data.chargebacks.length ? `${data.chargebacks.length.toLocaleString()} ${data.chargebacks.length === 1 ? "entry" : "entries"} on the carrier portals; the figure is what is still open.` : "The carrier portals list no chargebacks for this record."}</p>
          {data.chargebacks.length > 0 && (
            <ul className="mt-3 divide-y divide-border text-sm">
              {data.chargebacks.map((c) => (
                <li key={`${c.carrier ?? ""}:${c.policy_number ?? ""}:${c.chargeback_on ?? ""}:${c.amount ?? ""}`} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>{[c.carrier, c.policy_number].filter(Boolean).join(" · ")}{c.reason ? ` · ${c.reason}` : ""}</span>
                  <span className="tabular-nums">{c.amount === null ? "Amount not given" : money(c.amount, 2)}{c.status ? ` · ${c.status}` : ""}{c.chargeback_on ? ` · ${shortDate(c.chargeback_on)}` : ""}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="rounded-xl border border-border bg-card p-4 sm:p-5" aria-label="Ethos production snapshot">
          <p className="text-sm font-bold text-muted-foreground">Ethos production, from the Ethos portal</p>
          {data.ethos ? (
            <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <div><dt className="text-muted-foreground">Issued annual premium</dt><dd className="text-xl font-bold tabular-nums">{data.ethos.issued_annual_premium === null ? "Not given" : money(data.ethos.issued_annual_premium)}</dd></div>
              <div><dt className="text-muted-foreground">In force</dt><dd className="text-xl font-bold tabular-nums">{data.ethos.inforce_issued_premium === null ? "Not given" : money(data.ethos.inforce_issued_premium)}</dd></div>
              <div><dt className="text-muted-foreground">Persistency (4 / 7 / 13 mo)</dt><dd className="font-semibold tabular-nums">{[data.ethos.persistency_m4, data.ethos.persistency_m7, data.ethos.persistency_m13].map((p) => p === null ? "n/a" : `${Math.round(p * 100)}%`).join(" / ")}</dd></div>
              <div><dt className="text-muted-foreground">Outstanding chargeback</dt><dd className="font-semibold tabular-nums">{data.ethos.outstanding_chargeback === null ? "Not given" : money(data.ethos.outstanding_chargeback, 2)}</dd></div>
              <div className="col-span-2 text-xs text-muted-foreground">Snapshot {data.ethos.snapshot_on ? shortDate(data.ethos.snapshot_on) : "date not given"}{data.ethos.on_advanced_pay === null ? "" : data.ethos.on_advanced_pay ? " · on advanced pay" : " · as-earned"}. Portal totals can include a downline.</div>
            </dl>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">{data.agent.npn ? "The Ethos portal has no production snapshot for this NPN." : "No NPN is on file for this record, so the Ethos portal cannot be matched."}</p>
          )}
        </section>
      </div>

      <footer className="space-y-1 text-xs text-muted-foreground">
        <p>{bookFreshnessSentence(data.book.last_read_on, data.today, data.book.carriers)}</p>
        <p>{paidFeedSentence(data.sources)}</p>
        {onViewPolicies && <Button type="button" variant="link" className="h-auto p-0 text-xs" onClick={onViewPolicies}>Open the policy book for every carrier record</Button>}
      </footer>
    </div>
  );
}

function AgentPicker({ value, onChange }: { value: string | null; onChange: (id: string | null) => void }) {
  const { user } = useAuth();
  const agents = useQuery({
    queryKey: ["commissions-dashboard-agents", user?.id],
    enabled: Boolean(user),
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<AgentOption[]> => {
      const { data, error } = await supabase.from("agents").select("id, display_name").neq("status", "terminated").order("display_name").limit(1000);
      if (error) throw error;
      return (data ?? []) as AgentOption[];
    },
  });
  if (agents.isError) return <p role="alert" className="text-xs text-destructive">The agent list could not load; showing your own record.</p>;
  if (!agents.data || agents.data.length < 2) return null;
  return (
    <div className="flex items-center gap-2">
      <label htmlFor="commissions-agent" className="text-sm font-semibold">Viewing</label>
      <select id="commissions-agent" className="h-11 max-w-xs rounded-md border border-input bg-background px-3 text-sm" value={value ?? "me"} onChange={(e) => onChange(e.target.value === "me" ? null : e.target.value)}>
        <option value="me">My own record</option>
        {agents.data.filter((a) => a.display_name).map((a) => <option key={a.id} value={a.id}>{a.display_name}</option>)}
      </select>
    </div>
  );
}

export function CommissionsDashboard({ embedded, onViewPolicies }: { embedded?: boolean; onViewPolicies?: () => void }) {
  const { user, isAdmin, isManager } = useAuth();
  const [agentId, setAgentId] = useState<string | null>(null);
  const canPick = Boolean(isAdmin || isManager);
  const query = useQuery({
    queryKey: ["commissions-dashboard", user?.id, agentId],
    enabled: Boolean(user),
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("commissions_dashboard" as never, { p_agent_id: agentId } as never);
      if (error) throw error;
      return parseCommissionsDashboard(data);
    },
  });
  const payload = query.data;
  const isEmpty = payload !== undefined && payload.ok === false;
  const presentation = describeQuery(query);
  return (
    <div className={cn("space-y-4", !embedded && "page-enter mx-auto w-full max-w-7xl px-4 pb-24 sm:px-6")}>
      {canPick && <AgentPicker value={agentId} onChange={setAgentId} />}
      <QueryState
        {...presentation}
        status={isEmpty ? "empty" : presentation.status}
        label="commissions"
        onRetry={() => void query.refetch()}
        asOf={query.dataUpdatedAt}
        title={agentId ? "That agent has no commission record" : "No agent record is linked to this login"}
        body={agentId ? "The record exists but has no production in the last 13 months, or it is not linked to a producer." : "Ask your manager to link your agent record; until then there is nothing to price."}
      >
        {payload?.ok && <CommissionsDashboardView data={payload} onViewPolicies={onViewPolicies} onRefresh={() => void query.refetch()} refreshing={query.isFetching} />}
      </QueryState>
    </div>
  );
}
