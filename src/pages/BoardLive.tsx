/**
 * BoardLive (/board): the production board built to be screenshotted and posted.
 *
 * OVERHAUL-leaderboards (2026-10-29): it reads the same board as the Leaderboard
 * (leaderboard_team_board, through useTeamBoard), so the two can never disagree. Lead spend is
 * gone (leads are company-funded; the column only ever said $0). Only agents with $5,000 or
 * more in the month are ranked or counted, and the rule is printed under the title so it is in
 * every posted screenshot. The totals are the sum of exactly the rows shown. The income
 * estimate appears only for a viewer who may read every row's (Sam and the book readers), so a
 * posted board never lets one agent read another's contract level. Cheers show as a count; the
 * cheering itself happens on the Leaderboard.
 *
 * ?m=-1 shows last month, the board that usually gets posted right after a month closes.
 */
import { Link, useSearchParams } from "react-router-dom";
import { PartyPopper } from "lucide-react";
import { CountUp } from "@/components/ui/delight/CountUp";
import { TonePill } from "@/components/ui/delight/ToneBubble";
import { QueryState, describeQuery } from "@/components/ui/query-state";
import { useBrand } from "@/hooks/useBrand";
import { useTeamBoard } from "@/hooks/useTeamBoard";
import { boardTotals, formatMoney, formatTileMoney, monthName, nextMilestone, plural, rankTone, tenureLabel, type BoardWindow } from "@/lib/leaderboardBoard";
import { TONE_CLASS } from "@/lib/tones";
import { cn } from "@/lib/utils";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function BoardLive() {
  const [params] = useSearchParams();
  const window: BoardWindow = params.get("m") === "-1" ? "last_month" : "month";
  const brand = useBrand();
  const query = useTeamBoard(window);
  const board = query.data ?? null;
  const rows = board?.rows ?? [];
  const totals = boardTotals(rows);
  const showEstimate = Boolean(board?.fullReader) && rows.length > 0 && rows.every((r) => r.estEarnings !== null);
  const totalEstimate = showEstimate ? rows.reduce((sum, r) => sum + (r.estEarnings ?? 0), 0) : null;
  const leader = rows[0] ?? null;
  const milestone = leader ? nextMilestone(leader.ap) : 0;
  const pct = leader && milestone ? Math.min(100, (leader.ap / milestone) * 100) : 0;
  const month = board ? monthName(board.monthStart, query.todayKey) : null;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 pb-28">
      {query.isError && board ? (
        <div role="alert" className="rounded-xl border border-tone-hot/35 bg-tone-hot/8 px-4 py-3 text-[15px] font-semibold text-tone-hot">
          Live production is not updating right now. Do not post this board until it reconnects.
        </div>
      ) : null}

      <header className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[15px] font-semibold text-tone-good">
            <span aria-hidden="true" className="apex-breathe inline-block h-2 w-2 rounded-full bg-tone-good" />
            Live production board
          </p>
          <h1 className="mt-1.5 text-[1.75rem] font-bold leading-tight text-foreground sm:text-4xl">
            {brand.platformName} <span className="text-tone-gold">{month ?? " "}</span>
          </h1>
          {board ? (
            <p className="mt-1.5 text-[15px] leading-6 text-muted-foreground">
              Ranked: agents with {formatMoney(board.minimum)} or more in {month}.
            </p>
          ) : null}
        </div>
        {board && board.access === "team" ? (
          <dl className="grid grid-cols-3 gap-3 sm:flex sm:gap-8">
            <div>
              <dt className="text-[13px] font-semibold text-muted-foreground">Team sales</dt>
              <dd className="text-xl font-bold tabular-nums text-foreground sm:text-3xl"><CountUp value={totals.sales} format={formatTileMoney} /></dd>
            </div>
            {totalEstimate !== null ? (
              <div>
                <dt className="text-[13px] font-semibold text-muted-foreground">Est. earnings</dt>
                <dd className="text-xl font-bold tabular-nums text-tone-good sm:text-3xl"><CountUp value={totalEstimate} format={formatTileMoney} /></dd>
              </div>
            ) : null}
            <div>
              <dt className="text-[13px] font-semibold text-muted-foreground">Policies</dt>
              <dd className="text-xl font-bold tabular-nums text-foreground sm:text-3xl"><CountUp value={totals.deals} /></dd>
            </div>
          </dl>
        ) : null}
      </header>

      <QueryState
        {...describeQuery(query)}
        label="live production"
        onRetry={() => void query.refetch()}
        asOf={query.dataUpdatedAt}
      >
        {board && board.access === "none" ? (
          <p className="rounded-2xl border border-border bg-card px-4 py-6 text-center text-[15px] text-muted-foreground">
            The production board is for active agents on the team.
          </p>
        ) : board ? (
          <div className="space-y-4">
            {leader ? (
              <div className="rounded-2xl border border-tone-gold/35 bg-tone-gold/8 p-4">
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[15px]">
                  <span className="font-semibold text-foreground">
                    {leader.name ?? "—"} leads · next milestone {formatMoney(milestone)}
                  </span>
                  <span className="tabular-nums text-tone-gold">{formatMoney(Math.max(milestone - leader.ap, 0))} to go</span>
                </div>
                <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-foreground/10" role="presentation">
                  <div className="h-full rounded-full bg-tone-gold" style={{ width: `${pct}%` }} />
                </div>
              </div>
            ) : null}

            {rows.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-border bg-card px-4 py-10 text-center text-[15px] text-muted-foreground">
                Nobody has reached {formatMoney(board.minimum)} in {month} yet.
              </p>
            ) : (
              <ol className="space-y-3">
                {rows.map((r) => {
                  const tone = rankTone(r.rank);
                  const tenure = tenureLabel(r.firstPolicyDate, query.todayKey);
                  return (
                    <li
                      key={r.agentKey}
                      className={cn("rounded-2xl border bg-card p-4 sm:p-5", tone ? TONE_CLASS[tone].border : "border-border")}
                    >
                      {/* One number sits beside the name at every width; with the income column the two
                          numbers get their own line on phones so neither is squeezed. */}
                      <div className={cn("flex gap-3", showEstimate ? "flex-col sm:flex-row sm:items-center sm:gap-5" : "flex-row items-center gap-4 sm:gap-5")}>
                        <div className="flex min-w-0 items-center gap-3 sm:flex-1">
                          <span
                            className={cn(
                              "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border text-lg font-bold tabular-nums",
                              tone ? cn(TONE_CLASS[tone].soft, TONE_CLASS[tone].text, TONE_CLASS[tone].border) : "border-border bg-muted text-muted-foreground",
                            )}
                          >
                            <span className="sr-only">Rank </span>
                            {r.rank}
                          </span>
                          <div className="min-w-0 flex-1">
                            {r.readable && r.agentId && UUID.test(r.agentId) ? (
                              <Link
                                to={`/dashboard/profile?agentId=${encodeURIComponent(r.agentId)}`}
                                className="-my-2.5 inline-flex items-center text-lg font-bold leading-tight text-foreground underline-offset-4 [overflow-wrap:anywhere] hover:underline focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)] sm:my-0 sm:text-xl"
                              >
                                {r.name ?? "—"}
                              </Link>
                            ) : (
                              <p className="text-lg font-bold leading-tight text-foreground [overflow-wrap:anywhere] sm:text-xl">{r.name ?? "—"}</p>
                            )}
                            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                              {tenure ? <TonePill tone="good">{tenure}</TonePill> : null}
                              {r.departed ? <TonePill tone="slate">Left the team</TonePill> : null}
                              <span className="text-sm tabular-nums text-muted-foreground">{plural(r.deals, "policy", "policies")}</span>
                              {r.cheers > 0 ? (
                                <span className="inline-flex items-center gap-1 text-sm text-tone-gold">
                                  <PartyPopper className="h-4 w-4" aria-hidden="true" />
                                  {plural(r.cheers, "cheer")}
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </div>
                        <dl
                          className={cn(
                            showEstimate
                              ? "grid grid-cols-2 gap-2 border-t border-border pt-3 sm:flex sm:shrink-0 sm:items-center sm:gap-8 sm:border-0 sm:pt-0"
                              : "shrink-0 text-right",
                          )}
                        >
                          <div className="sm:text-right">
                            <dt className="text-[13px] font-semibold text-muted-foreground">Production</dt>
                            <dd className="text-lg font-bold tabular-nums text-foreground sm:text-2xl"><CountUp value={r.ap} format={formatMoney} /></dd>
                          </div>
                          {showEstimate ? (
                            <div className="sm:text-right">
                              <dt className="text-[13px] font-semibold text-muted-foreground">Est. income</dt>
                              <dd className="text-lg font-bold tabular-nums text-tone-good sm:text-2xl"><CountUp value={r.estEarnings} format={formatMoney} /></dd>
                            </div>
                          ) : null}
                        </dl>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        ) : null}
      </QueryState>

      <p className="border-t border-border pt-4 text-sm leading-relaxed text-muted-foreground">
        Production is posted annual premium from the agency&rsquo;s book.
        {showEstimate
          ? " Est. income is an estimate from each producer’s contract levels, before chargebacks, advances and overrides; individual results vary."
          : null}
      </p>
    </div>
  );
}
