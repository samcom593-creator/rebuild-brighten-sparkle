/**
 * ContractsBoard — the real APEX contracting book.
 *
 * Mirrors the Contracts screen anatomy: scope pills (Mine / Agency / Total
 * IMO), a four-stat headline row, status chips carrying their own counts, a
 * "Showing X of Y contracts" readout, and one row per contract showing carrier,
 * producer, commission level, status and writing number.
 *
 * Runtime source: APEX carrier appointments + the local carrier catalog. The
 * contracting flow itself is profile data, Ethos sheet, and private Discord;
 * no AgentLink invite or contract lookup is required.
 *
 * EVERY NUMBER HERE IS AGGREGATED IN THE DATABASE.
 * apex_contracts_summary returns the counts; the row list is a separate,
 * page-capped call. Nothing on screen is derived from `rows.length`, because
 * PostgREST stops at 1000 rows and a headline built from an array length would
 * quietly under-report the moment the book crossed that line.
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { AlertTriangle, FileSignature, Search, Users, Building2 } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { GlassCard } from "@/components/ui/glass-card";
import { EmptyState } from "@/components/ui/empty-state";

export type ContractScope = "mine" | "agency" | "imo";

export interface ContractRow {
  id: string;
  carrier_name: string | null;
  agent_name: string | null;
  agent_id: string | null;
  status: string | null;
  commission_level: string | null;
  writing_number: string | null;
  contract_number: string | null;
  requested_at: string | null;
  activated_date: string | null;
}

export interface ContractSummary {
  total: number;
  active: number;
  requested: number;
  issues: number;
  by_status: Record<string, number>;
}

const EMPTY_SUMMARY: ContractSummary = { total: 0, active: 0, requested: 0, issues: 0, by_status: {} };

const PAGE_SIZE = 100;

/**
 * Chip order mirrors the reference screen's left-to-right progression. The
 * labels are our own status vocabulary, not the reference's — `jail` and
 * `pending_upline_assignment` are real states in this book with no equivalent
 * over there, and renaming them to something familiar would misreport them.
 * A status only appears as a chip when the scoped book actually contains it.
 */
const STATUS_ORDER: Array<{ key: string; label: string }> = [
  { key: "ready_to_contract", label: "Ready to contract" },
  { key: "requested", label: "Requested" },
  { key: "pending_upline_assignment", label: "Pending upline" },
  { key: "submitted", label: "Submitted" },
  { key: "active", label: "Active" },
  { key: "issue", label: "Issue" },
  { key: "jail", label: "Jail" },
  { key: "rejected", label: "Rejected" },
];

const SCOPES: Array<{ key: ContractScope; label: string }> = [
  { key: "mine", label: "Mine" },
  { key: "agency", label: "Agency" },
  { key: "imo", label: "Total IMO" },
];

function statusTone(status: string | null): string {
  switch ((status ?? "").toLowerCase()) {
    case "active":
      return "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400 border-emerald-500/30";
    case "issue":
    case "jail":
      return "bg-amber-500/12 text-amber-600 dark:text-amber-400 border-amber-500/30";
    case "rejected":
      return "bg-rose-500/12 text-rose-600 dark:text-rose-400 border-rose-500/30";
    case "submitted":
    case "pending_upline_assignment":
      return "bg-primary/12 text-primary border-primary/30";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

function humanStatus(status: string | null): string {
  if (!status) return "Unknown";
  const found = STATUS_ORDER.find((s) => s.key === status.toLowerCase());
  return found ? found.label : status.replace(/_/g, " ");
}

export function useContractSummary(scope: ContractScope, search: string) {
  return useQuery({
    queryKey: ["apex-contracts-summary", scope, search],
    staleTime: 60_000,
    queryFn: async (): Promise<ContractSummary> => {
      const { data, error } = await supabase.rpc("apex_contracts_summary" as never, {
        p_scope: scope,
        p_search: search || null,
      } as never);
      if (error) throw error;
      return { ...EMPTY_SUMMARY, ...((data ?? {}) as Partial<ContractSummary>) };
    },
  });
}

export function useContractRows(scope: ContractScope, status: string, search: string, page: number) {
  return useQuery({
    queryKey: ["apex-contracts-list", scope, status, search, page],
    staleTime: 60_000,
    queryFn: async (): Promise<ContractRow[]> => {
      const { data, error } = await supabase.rpc("apex_contracts_list" as never, {
        p_scope: scope,
        p_status: status,
        p_search: search || null,
        p_limit: PAGE_SIZE,
        p_offset: page * PAGE_SIZE,
      } as never);
      if (error) throw error;
      return (data ?? []) as ContractRow[];
    },
  });
}

export function ContractsBoard({
  canInvite,
  canSeeImo,
  initialScope = "agency",
}: {
  canInvite: boolean;
  canSeeImo: boolean;
  initialScope?: ContractScope;
}) {
  const [scope, setScope] = useState<ContractScope>(initialScope);
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);

  const summaryQ = useContractSummary(scope, search);
  const rowsQ = useContractRows(scope, status, search, page);

  const summary = summaryQ.data ?? EMPTY_SUMMARY;
  const rows = rowsQ.data ?? [];
  const errorMsg = (summaryQ.error as Error | null)?.message ?? (rowsQ.error as Error | null)?.message ?? null;

  // Chips are built from the server's by_status map, so a chip can never claim
  // a count the row query would not return.
  const chips = useMemo(() => {
    const present = STATUS_ORDER.filter((s) => (summary.by_status?.[s.key] ?? 0) > 0);
    const known = new Set(STATUS_ORDER.map((s) => s.key));
    const unknown = Object.entries(summary.by_status ?? {})
      .filter(([key, count]) => !known.has(key) && count > 0)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, n]) => ({ key, label: humanStatus(key), n }));
    return [{ key: "all", label: "All", n: summary.total }, ...present.map((s) => ({ ...s, n: summary.by_status[s.key] })), ...unknown];
  }, [summary]);

  const shownCount = status === "all" ? summary.total : (summary.by_status?.[status] ?? 0);

  const reset = (fn: () => void) => { fn(); setPage(0); };

  return (
    <div className="space-y-4">
      {/* Scope + primary actions — the reference puts these on one right-aligned row */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {SCOPES.filter((s) => s.key !== "imo" || canSeeImo).map((s) => (
            <Button
              key={s.key}
              size="sm"
              variant={scope === s.key ? "default" : "outline"}
              onClick={() => reset(() => { setScope(s.key); setStatus("all"); })}
              data-testid={`scope-${s.key}`}
            >
              {s.label}
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild size="sm" variant="outline">
            <Link to="/dashboard/contracting/carriers"><Building2 className="h-4 w-4" /> Carrier directory</Link>
          </Button>
          {canInvite && (
            <Button asChild size="sm">
              <Link to="/admin/invite-links"><Users className="h-4 w-4" /> Invite an agent</Link>
            </Button>
          )}
        </div>
      </div>

      {/* Headline row — every figure server-aggregated */}
      <GlassCard className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
        {([
          ["Total", summary.total, ""],
          ["Active", summary.active, "text-emerald-600 dark:text-emerald-400"],
          ["Requested", summary.requested, ""],
          ["Issues", summary.issues, summary.issues > 0 ? "text-amber-600 dark:text-amber-400" : ""],
        ] as const).map(([label, value, tone]) => (
          <div key={label}>
            <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">{label}</p>
            {summaryQ.isLoading ? (
              <Skeleton className="mt-1 h-8 w-14" />
            ) : (
              <p className={cn("mt-0.5 text-3xl font-bold tabular-nums", tone)}>{value}</p>
            )}
          </div>
        ))}
      </GlassCard>

      {errorMsg && (
        <div className="flex items-start gap-3 rounded-lg border border-rose-500/35 bg-rose-500/5 p-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600 dark:text-rose-400" />
          <div className="min-w-0">
            <p className="text-sm font-semibold">Contracts could not load</p>
            <p className="mt-0.5 break-words text-xs text-muted-foreground">{errorMsg.slice(0, 160)}</p>
          </div>
        </div>
      )}

      {/* Search + status chips */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => reset(() => setSearch(e.target.value))}
            placeholder="Search carrier, producer, or writing number"
            className="pl-9"
            data-testid="contracts-search"
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Showing <span className="font-semibold tabular-nums text-foreground">{rows.length === 0 ? 0 : `${page * PAGE_SIZE + 1}–${page * PAGE_SIZE + rows.length}`}</span> of{" "}
          <span className="font-semibold tabular-nums text-foreground">{shownCount}</span> contracts
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {chips.map((c) => (
          <Button
            key={c.key}
            size="sm"
            variant={status === c.key ? "default" : "outline"}
            className="h-8 text-xs"
            onClick={() => reset(() => setStatus(c.key))}
            data-testid={`status-${c.key}`}
          >
            {c.label}: {c.n}
          </Button>
        ))}
      </div>

      {/* Rows */}
      <GlassCard className="overflow-hidden">
        <div className="hidden grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_110px_130px_110px] border-b border-border bg-muted/40 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground sm:grid">
          <span>Carrier</span><span>Producer</span><span>Level</span><span>Status</span><span>Writing #</span>
        </div>
        {rowsQ.isLoading ? (
          <div className="space-y-2 p-4">
            {["a", "b", "c", "d"].map((k) => <Skeleton key={k} className="h-11 w-full" />)}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<FileSignature className="h-7 w-7" />}
            title={scope === "mine" ? "No contracts on your own producer record" : "No contracts match this view"}
            description={
              scope === "mine"
                ? "Carrier appointments written under your login appear here. Switch to Agency to see the team's book."
                : "Clear the search or pick a different status to widen the view."
            }
          />
        ) : (
          <ul>
            {rows.map((row) => (
              <li
                key={row.id}
                className="grid grid-cols-2 gap-x-3 gap-y-1 border-b border-border/70 px-4 py-3 text-sm last:border-0 sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_110px_130px_110px] sm:items-center sm:gap-y-0"
              >
                <span className="truncate font-medium">{row.carrier_name ?? "Carrier not on file"}</span>
                <span className="truncate text-muted-foreground">{row.agent_name ?? "Producer not on file"}</span>
                <span className="truncate tabular-nums text-muted-foreground">{row.commission_level ?? "—"}</span>
                <span>
                  <span className={cn("inline-block rounded border px-1.5 py-0.5 text-[11px] font-medium capitalize", statusTone(row.status))}>
                    {humanStatus(row.status)}
                  </span>
                </span>
                <span className="truncate font-mono text-xs text-muted-foreground">{row.writing_number ?? "—"}</span>
              </li>
            ))}
          </ul>
        )}
      </GlassCard>

      {/* Paging only appears when the server says there is more than this page. */}
      {shownCount > PAGE_SIZE && (
        <div className="flex items-center justify-between gap-2">
          <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
            Previous
          </Button>
          <p className="text-xs text-muted-foreground">
            Page {page + 1} of {Math.max(1, Math.ceil(shownCount / PAGE_SIZE))}
          </p>
          <Button
            size="sm"
            variant="outline"
            disabled={(page + 1) * PAGE_SIZE >= shownCount}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
