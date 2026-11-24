import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

// MP-CARRIER-BOOK-TRUTH — Sam, 2026-11-24: "for each profile ... production, chargebacks,
// breakdown of policy to policy status to see if it's submitted, or actually approved, or
// actually charged back ... since it's just Combined + Ethos, where everything is actually at."
// One read: agent_carrier_book(p_agent_id) — the live Ethos + Chubb/Combined portal pull,
// scoped in the database (owner/admin all, a leader their tree, an agent themselves).

type Bucket = "pending" | "active" | "claim" | "at_risk" | "lapsed" | "not_taken" | "declined" | "abandoned" | "unknown";

interface CarrierPolicy {
  key: string;
  carrier: string;
  underwriter: string | null;
  policy_number: string | null;
  client: string | null;
  product: string | null;
  bucket: Bucket;
  label: string;
  status_raw: string | null;
  close_reason: string | null;
  annual_premium: number | null;
  face_amount: number | null;
  sold_on: string | null;
  effective_on: string | null;
  changed_on: string | null;
  on_site: boolean;
  chargeback: number | null;
}

interface CarrierBook {
  agent_id: string;
  as_of: string | null;
  summary: {
    written: number; written_ap: number; written_30d: number; written_30d_ap: number;
    submitted: number; in_force: number; in_force_ap: number; at_risk: number; lapsed: number;
    not_placed: number; retention_pct: number | null; not_on_site: number;
    chargebacks: number; chargeback_amount: number; debt_outstanding: number;
  };
  by_carrier: Array<{ carrier: string; written: number; in_force: number; lapsed: number }>;
  ethos_portal: { issued_ap: number | null; inforce_ap: number | null; persistency_m13: number | null; outstanding_chargeback: number | null } | null;
  policies: CarrierPolicy[];
}

const usd = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const day = (iso: string | null) =>
  iso ? new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" }) : "—";

const FILTERS: Array<{ key: string; label: string; match: (b: Bucket) => boolean }> = [
  { key: "all", label: "All", match: () => true },
  { key: "submitted", label: "Submitted", match: (b) => b === "pending" },
  { key: "in_force", label: "Approved", match: (b) => b === "active" || b === "claim" },
  { key: "at_risk", label: "At risk", match: (b) => b === "at_risk" },
  { key: "lapsed", label: "Charged back", match: (b) => b === "lapsed" },
  { key: "not_placed", label: "Never placed", match: (b) => b === "not_taken" || b === "declined" || b === "abandoned" },
];

const TONE: Record<Bucket, string> = {
  active: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  claim: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  pending: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  at_risk: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  lapsed: "bg-red-500/15 text-red-700 dark:text-red-300",
  not_taken: "bg-muted text-muted-foreground",
  declined: "bg-muted text-muted-foreground",
  abandoned: "bg-muted text-muted-foreground",
  unknown: "bg-muted text-muted-foreground",
};

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "bad" | "warn" }) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2">
      <div className="text-[12px] text-muted-foreground">{label}</div>
      <div className={cn("text-base font-semibold tabular-nums",
        tone === "good" && "text-emerald-700 dark:text-emerald-300",
        tone === "bad" && "text-red-700 dark:text-red-300",
        tone === "warn" && "text-amber-700 dark:text-amber-300")}>{value}</div>
      {sub ? <div className="text-[12px] text-muted-foreground">{sub}</div> : null}
    </div>
  );
}

export function AgentCarrierBookPanel({ agentId, compact = false }: { agentId: string; compact?: boolean }) {
  const [filter, setFilter] = useState("all");
  const query = useQuery({
    queryKey: ["agent-carrier-book", agentId],
    enabled: !!agentId,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<CarrierBook> => {
      const { data, error } = await supabase.rpc("agent_carrier_book" as never, { p_agent_id: agentId } as never);
      if (error) throw error;
      return data as unknown as CarrierBook;
    },
  });

  const book = query.data;
  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const f of FILTERS) m[f.key] = (book?.policies ?? []).filter((p) => f.match(p.bucket)).length;
    return m;
  }, [book]);
  const shown = useMemo(() => {
    const f = FILTERS.find((x) => x.key === filter) ?? FILTERS[0];
    return (book?.policies ?? []).filter((p) => f.match(p.bucket));
  }, [book, filter]);

  if (!agentId) return null;

  return (
    <section className="space-y-3 border-t border-border pt-4" aria-label="Carrier book">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-[15px] font-semibold text-foreground">Carrier book · Ethos + Combined</h3>
        {book?.as_of ? <span className="text-[12px] text-muted-foreground">pulled {new Date(book.as_of).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span> : null}
      </div>

      {query.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading the carrier book…</p>
      ) : query.isError || !book ? (
        <p role="status" className="text-sm text-amber-700 dark:text-amber-400">
          Carrier book unavailable — these numbers are unknown, not zero.{" "}
          <button type="button" aria-label="Retry the carrier book" className="font-semibold underline" onClick={() => void query.refetch()}>Retry</button>
        </p>
      ) : book.policies.length === 0 ? (
        <p className="text-sm text-muted-foreground">No Ethos or Combined policies under this agent in the carrier portals.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Tile label="Written (all time)" value={usd(book.summary.written_ap)} sub={`${book.summary.written} policies`} />
            <Tile label="Last 30 days" value={usd(book.summary.written_30d_ap)} sub={`${book.summary.written_30d} policies`} />
            <Tile label="Approved · in force" value={String(book.summary.in_force)} sub={usd(book.summary.in_force_ap)} tone="good" />
            <Tile label="Retention" value={book.summary.retention_pct == null ? "—" : `${book.summary.retention_pct}%`}
              sub="in force ÷ issued" tone={book.summary.retention_pct == null ? undefined : book.summary.retention_pct >= 75 ? "good" : book.summary.retention_pct >= 50 ? "warn" : "bad"} />
            <Tile label="Submitted" value={String(book.summary.submitted)} sub="awaiting issue / payment" />
            <Tile label="At risk" value={String(book.summary.at_risk)} sub="missed payment" tone={book.summary.at_risk ? "warn" : undefined} />
            <Tile label="Lapsed · charged back" value={String(book.summary.lapsed)} tone={book.summary.lapsed ? "bad" : undefined} />
            <Tile label="Chargebacks" value={usd(book.summary.chargeback_amount)} sub={`${book.summary.chargebacks} clawbacks${book.summary.debt_outstanding ? ` · ${usd(book.summary.debt_outstanding)} owed` : ""}`}
              tone={book.summary.chargeback_amount ? "bad" : undefined} />
          </div>

          {book.summary.not_on_site > 0 ? (
            <p className="text-[13px] text-muted-foreground">
              {book.summary.not_on_site} written in the portal but never posted on the site — they count toward production from the carrier book.
            </p>
          ) : null}

          {!compact && book.by_carrier.length > 1 ? (
            <p className="text-[13px] text-muted-foreground">
              {book.by_carrier.map((c) => `${c.carrier}: ${c.written} written · ${c.in_force} in force · ${c.lapsed} lapsed`).join("  ·  ")}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filter policies by status">
            {FILTERS.map((f) => (
              <button key={f.key} type="button" role="tab" aria-selected={filter === f.key}
                onClick={() => setFilter(f.key)}
                className={cn("h-8 rounded-full border px-3 text-[13px] transition-colors",
                  filter === f.key ? "border-primary bg-primary text-primary-foreground" : "border-border text-foreground hover:bg-muted")}>
                {f.label} <span className="tabular-nums opacity-70">{counts[f.key]}</span>
              </button>
            ))}
          </div>

          {shown.length === 0 ? (
            <p className="text-sm text-muted-foreground">No policies in this status.</p>
          ) : (
            <ul className={cn("divide-y divide-border rounded-lg border border-border", compact ? "max-h-80 overflow-y-auto" : "max-h-[28rem] overflow-y-auto")}>
              {shown.map((p) => (
                <li key={p.key} className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 px-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-foreground">{p.client ?? "Client not shown"}</div>
                    <div className="truncate text-[12px] text-muted-foreground">
                      {p.carrier}{p.underwriter ? ` (${p.underwriter})` : ""} · {p.policy_number ?? "no policy #"}{p.product ? ` · ${p.product}` : ""}
                    </div>
                    <div className="text-[12px] text-muted-foreground">
                      Sold {day(p.sold_on)}{p.changed_on ? ` · status changed ${day(p.changed_on)}` : ""}{p.on_site ? "" : " · not posted on site"}
                      {p.close_reason ? ` · ${p.close_reason}` : ""}
                    </div>
                  </div>
                  <div className="text-right">
                    <span className={cn("inline-block rounded-full px-2 py-0.5 text-[12px] font-medium", TONE[p.bucket] ?? TONE.unknown)} title={p.status_raw ?? undefined}>{p.label}</span>
                    <div className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">{usd(p.annual_premium)}</div>
                    {p.chargeback ? <div className="text-[12px] font-medium text-red-700 dark:text-red-300">−{usd(p.chargeback)} clawed</div> : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

export interface TeamCarrierStats {
  written_30d: number; ap_30d: number; submitted: number; in_force: number; at_risk: number; lapsed: number;
  retention_pct: number | null; last_sold_on: string | null; chargeback_amount: number;
}

/** Per-agent carrier stats for everyone the viewer can see (one read for the whole My Team list). */
export function useTeamCarrierSummary() {
  return useQuery({
    queryKey: ["team-carrier-book-summary"],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Record<string, TeamCarrierStats>> => {
      const { data, error } = await supabase.rpc("team_carrier_book_summary" as never);
      if (error) throw error;
      return (data ?? {}) as unknown as Record<string, TeamCarrierStats>;
    },
  });
}

/** "Carrier: 4 in force · 1 at risk · 2 lapsed · 57% kept" — null when the agent has no carrier policies. */
export function teamCarrierLine(s: TeamCarrierStats | undefined): { text: string; tone: "good" | "warn" | "bad" | null } | null {
  if (!s || s.in_force + s.at_risk + s.lapsed + s.submitted === 0) return null;
  const bits = [`${s.in_force} in force`];
  if (s.submitted) bits.push(`${s.submitted} submitted`);
  if (s.at_risk) bits.push(`${s.at_risk} at risk`);
  if (s.lapsed) bits.push(`${s.lapsed} lapsed`);
  if (s.retention_pct != null) bits.push(`${s.retention_pct}% kept`);
  if (s.written_30d) bits.push(`${s.written_30d} written 30d`);
  const tone = s.retention_pct == null ? null : s.retention_pct >= 75 ? "good" : s.retention_pct >= 50 ? "warn" : "bad";
  return { text: `Carrier: ${bits.join(" · ")}`, tone };
}
