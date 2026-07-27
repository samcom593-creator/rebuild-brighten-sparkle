import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { DollarSign, AlertTriangle, ArrowRight, Info } from "lucide-react";

import { GlassCard } from "@/components/ui/glass-card";
import { supabase } from "@/integrations/supabase/client";

/**
 * EarningsEstimateCard — the closest thing to "what have we actually earned"
 * that this database can honestly answer.
 *
 * Sam asked for earnings back on the dashboard. The dashboard's ALP tiles are
 * premium volume, not income, and real income was never captured anywhere:
 * agentlink_commissions has 0 rows ever, insuracloud_payouts has 0 rows ever,
 * agents.total_earnings is 0 for all 176 rows, and commission_ledger holds 148
 * rows totalling $447. There is no payout feed to read.
 *
 * So this reads v_earnings_estimate (posted premium x contract %), split into
 * business that is IN FORCE (a carrier can actually pay on it) versus business
 * that is SUBMITTED and has not issued yet. Both are labelled ESTIMATE on the
 * face of the card, not in a tooltip — a number this size must not be mistaken
 * for settled money.
 *
 * The split is the point: the pending column dwarfs the earned column, which is
 * the whole argument for chasing submitted business to issued-paid.
 */

type EarningsRow = {
  agent_name: string | null;
  est_earned_in_force: number | null;
  est_pending_if_issued: number | null;
};

const money = (n: number) =>
  n >= 1_000_000
    ? `$${(n / 1_000_000).toFixed(2)}M`
    : n >= 1_000
      ? `$${Math.round(n / 1_000)}K`
      : `$${Math.round(n)}`;

export function EarningsEstimateCard() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["v_earnings_estimate", "dashboard-summary"],
    queryFn: async (): Promise<EarningsRow[]> => {
      const { data, error } = await supabase
        .from("v_earnings_estimate" as any)
        .select("agent_name, est_earned_in_force, est_pending_if_issued");
      if (error) throw error;
      return (data ?? []) as unknown as EarningsRow[];
    },
    staleTime: 5 * 60 * 1000,
  });

  const rows = data ?? [];
  const earned = rows.reduce((s, r) => s + Number(r.est_earned_in_force ?? 0), 0);
  const pending = rows.reduce((s, r) => s + Number(r.est_pending_if_issued ?? 0), 0);
  const topPending = [...rows]
    .sort((a, b) => Number(b.est_pending_if_issued ?? 0) - Number(a.est_pending_if_issued ?? 0))
    .slice(0, 3);

  return (
    <GlassCard className="p-4">
      <div className="flex items-center gap-2">
        <DollarSign className="h-4 w-4 shrink-0 text-muted-foreground" />
        <p className="min-w-0 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
          Estimated commission
        </p>
      </div>

      {/* A failed fetch must never render as $0 earned. */}
      {isError ? (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-rose-500/35 bg-rose-500/5 p-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
          <div className="min-w-0">
            <p className="text-sm font-semibold">Earnings could not load</p>
            <p className="mt-0.5 break-words text-xs text-muted-foreground">
              {(error as any)?.message?.slice(0, 90) ?? "Unknown error"}
            </p>
            <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
              This is missing, not zero.
            </p>
          </div>
        </div>
      ) : isLoading ? (
        <div className="mt-3 space-y-2" aria-hidden>
          <div className="h-8 w-32 animate-pulse rounded bg-muted" />
          <div className="h-4 w-48 animate-pulse rounded bg-muted" />
        </div>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                In force
              </p>
              <p className="mt-1 break-words text-3xl font-bold leading-none tabular-nums text-emerald-600 dark:text-emerald-400">
                {money(earned)}
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                Carrier can pay on this
              </p>
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                Pending if issued
              </p>
              <p className="mt-1 break-words text-3xl font-bold leading-none tabular-nums text-amber-600 dark:text-amber-400">
                {money(pending)}
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                Submitted, not issued yet
              </p>
            </div>
          </div>

          {topPending.length > 0 && (
            <div className="mt-3 border-t border-border pt-3">
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                Most pending
              </p>
              <ul className="mt-1.5 space-y-1">
                {topPending.map((r) => (
                  <li
                    key={r.agent_name ?? "unknown"}
                    className="flex min-w-0 items-baseline justify-between gap-2 text-xs"
                  >
                    <span className="truncate text-foreground">{r.agent_name ?? "Unattributed"}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {money(Number(r.est_pending_if_issued ?? 0))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
            <p className="min-w-0 text-[11px] leading-relaxed text-muted-foreground">
              <span className="font-semibold text-amber-600 dark:text-amber-400">Estimate.</span>{" "}
              Premium x contract %. No payout feed exists yet, so this is not settled money.
            </p>
          </div>

          <Link
            to="/dashboard/book-of-business"
            className="mt-3 inline-flex items-center gap-1.5 rounded-md text-xs font-semibold text-primary transition-colors hover:text-primary/80 focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]"
          >
            Work the pending book
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </>
      )}
    </GlassCard>
  );
}

export default EarningsEstimateCard;
