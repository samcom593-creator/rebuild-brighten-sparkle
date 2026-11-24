import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { openAgentProfile } from "@/stores/agentProfileDrawer";
import { cn } from "@/lib/utils";

// MP-CARRIER-BOOK-TRUTH — Sam, 2026-11-24: "on the dashboard it shows for each deal which
// carrier it went to, and the status of the deal, whether it's approved." One read:
// dashboard_deal_status(p_start, p_end) — every deal in the window (including deals the
// carrier says were never placed, flagged not counted) with its live carrier status.
// Scoped in the database: owner/admin everyone, a leader their tree, an agent themselves.

interface DealStatusRow {
  key: string;
  agent_id: string | null;
  agent: string | null;
  client: string | null;
  carrier: string | null;
  underwriter: string | null;
  product: string | null;
  policy_number: string | null;
  annual_premium: number | null;
  posted_date: string;
  counted: boolean;
  from_portal: boolean;
  bucket: string;
  label: string;
  status_raw: string | null;
  changed_on: string | null;
  close_reason: string | null;
}

const PERIODS = [
  { key: "today", label: "Today" },
  { key: "week", label: "This week" },
  { key: "month", label: "This month" },
  { key: "last30", label: "Last 30 days" },
] as const;
type PeriodKey = (typeof PERIODS)[number]["key"];

const FILTERS: Array<{ key: string; label: string; match: (b: string) => boolean }> = [
  { key: "all", label: "All", match: () => true },
  { key: "approved", label: "Approved", match: (b) => b === "active" || b === "claim" },
  { key: "submitted", label: "Submitted", match: (b) => b === "pending" },
  { key: "trouble", label: "At risk / charged back", match: (b) => b === "at_risk" || b === "lapsed" },
  { key: "not_placed", label: "Never placed", match: (b) => b === "not_taken" || b === "declined" || b === "abandoned" },
  { key: "missing", label: "Not in portal", match: (b) => b === "missing" || b === "not_found" },
];

const TONE: Record<string, string> = {
  active: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  claim: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  pending: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  at_risk: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  lapsed: "bg-red-500/15 text-red-700 dark:text-red-300",
  missing: "bg-red-500/10 text-red-700 dark:text-red-300",
  not_found: "bg-muted text-muted-foreground",
  no_feed: "bg-muted text-muted-foreground",
};

/** Phoenix calendar day (Sam's time-zone rule), as YYYY-MM-DD. */
function phoenixToday(): Date {
  const s = new Date().toLocaleDateString("en-CA", { timeZone: "America/Phoenix" });
  return new Date(`${s}T12:00:00`);
}
const iso = (d: Date) => d.toLocaleDateString("en-CA");
function windowFor(p: PeriodKey): { start: string; end: string } {
  const t = phoenixToday();
  const end = new Date(t); end.setDate(end.getDate() + 1);
  const start = new Date(t);
  if (p === "week") start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  if (p === "month") start.setDate(1);
  if (p === "last30") start.setDate(start.getDate() - 29);
  return { start: iso(start), end: iso(end) };
}
const usd = (n: number | null) => (n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }));
const day = (s: string) => new Date(`${s.slice(0, 10)}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export function DealCarrierStatusCard() {
  const [period, setPeriod] = useState<PeriodKey>("month");
  const [filter, setFilter] = useState("all");
  const win = windowFor(period);

  const query = useQuery({
    queryKey: ["dashboard-deal-status", win.start, win.end],
    staleTime: 2 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("dashboard_deal_status" as never, { p_start: win.start, p_end: win.end } as never);
      if (error) throw error;
      return data as unknown as { as_of: string | null; deals: DealStatusRow[] };
    },
  });

  const deals = useMemo(() => query.data?.deals ?? [], [query.data]);
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.key, deals.filter((d) => f.match(d.bucket)).length])), [deals]);
  const shown = useMemo(() => deals.filter((d) => (FILTERS.find((f) => f.key === filter) ?? FILTERS[0]).match(d.bucket)), [deals, filter]);

  return (
    <section className="rounded-xl border border-border bg-card p-4 sm:p-5" aria-label="Deals by carrier and status">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Every deal · carrier &amp; status</h2>
          <p className="text-[13px] text-muted-foreground">
            Status is the carrier's own (Ethos + Combined portals{query.data?.as_of ? `, pulled ${new Date(query.data.as_of).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : ""}). Tap a deal to open the agent.
          </p>
        </div>
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Period">
          {PERIODS.map((p) => (
            <button key={p.key} type="button" role="tab" aria-selected={period === p.key} onClick={() => setPeriod(p.key)}
              className={cn("h-8 rounded-md px-2.5 text-[13px]", period === p.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5" role="tablist" aria-label="Filter deals by status">
        {FILTERS.map((f) => (
          <button key={f.key} type="button" role="tab" aria-selected={filter === f.key} onClick={() => setFilter(f.key)}
            className={cn("h-8 rounded-full border px-3 text-[13px]", filter === f.key ? "border-primary bg-primary text-primary-foreground" : "border-border text-foreground hover:bg-muted")}>
            {f.label} <span className="tabular-nums opacity-70">{query.data ? counts[f.key] : "—"}</span>
          </button>
        ))}
      </div>

      <div className="mt-3">
        {query.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading deals…</p>
        ) : query.isError ? (
          <p role="status" className="text-sm text-amber-700 dark:text-amber-400">
            Deal statuses unavailable — unknown, not zero. <button type="button" aria-label="Retry deal statuses" className="font-semibold underline" onClick={() => void query.refetch()}>Retry</button>
          </p>
        ) : shown.length === 0 ? (
          <p className="text-sm text-muted-foreground">No deals in this period{filter !== "all" ? " with this status" : ""}.</p>
        ) : (
          <ul className="max-h-[32rem] divide-y divide-border overflow-y-auto rounded-lg border border-border">
            {shown.map((d) => (
              <li key={d.key}>
                <button type="button" disabled={!d.agent_id} onClick={() => d.agent_id && openAgentProfile(d.agent_id)}
                  className="grid w-full grid-cols-[1fr_auto] gap-x-3 px-3 py-2 text-left hover:bg-muted/50 disabled:cursor-default">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-foreground">
                      {d.agent ?? "Agent"}{d.client ? <span className="font-normal text-muted-foreground"> · {d.client}</span> : null}
                    </span>
                    <span className="block truncate text-[12px] text-muted-foreground">
                      <span className="font-medium text-foreground">{d.carrier ?? "Carrier not set"}</span>
                      {d.underwriter ? ` (${d.underwriter})` : ""}{d.product ? ` · ${d.product}` : ""} · {d.policy_number ?? "no policy #"} · {day(d.posted_date)}
                      {d.from_portal ? " · found in portal, never posted" : ""}
                      {!d.counted ? " · not counted in production" : ""}
                    </span>
                  </span>
                  <span className="text-right">
                    <span className={cn("inline-block rounded-full px-2 py-0.5 text-[12px] font-medium", TONE[d.bucket] ?? "bg-muted text-muted-foreground")} title={d.status_raw ?? d.close_reason ?? undefined}>
                      {d.label}
                    </span>
                    <span className={cn("block text-sm font-semibold tabular-nums", d.counted ? "text-foreground" : "text-muted-foreground line-through")}>{usd(d.annual_premium)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
