import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AnimatedCounter } from "@/components/ui/animated-counter";
import { cn } from "@/lib/utils";
import { Link } from "react-router-dom";

// BoardLive — the screenshot/post-ready production board.
// Deliberately its own page (not the /leaderboard control surface): this one is
// built to be captured and posted, so it is dark, dense, and reads like a live
// game tracker. Numbers come from leaderboard_board (AgentLink book + deals
// posted in-app + Discord-reported, de-duplicated by v_production_canonical);
// nothing here is padded. Est. income is computed from each producer's true carrier
// contract levels — we never expose the comp % itself (agents must not be able to
// compare contracts off a public board).

type BoardRow = {
  agent_key: string;
  agent_id: string | null;
  agent_name: string | null;
  avatar_url: string | null;
  deals: number | string;
  ap: number | string;
  est_earnings: number | string;
  lead_cost: number | string;
  first_policy_date: string | null;
  tenure_label: string | null;
  weeks_with_agency: number | string;
};

function monthBounds(offset = 0) {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset + 1, 1));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10), label: start.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }) };
}

const money = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });

function hasAgentProfile(agentId: string | null | undefined): agentId is string {
  return Boolean(agentId && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(agentId));
}

// Rank treatments: gold / silver / bronze glow for the podium, neutral below.
// The three glows below are the podium/trophy treatment on a board built to be
// screenshotted and posted — the medal tiers must read at a glance in an image.
const RANK_STYLE: Record<number, { ring: string; badge: string; glow: string }> = {
  // shadow-glow-allow: trophy — 1st place podium tier on the postable board
  1: { ring: "ring-amber-400/60", badge: "bg-amber-400/15 text-amber-300 border-amber-400/40", glow: "shadow-[0_0_40px_-12px_rgba(251,191,36,0.55)]" },
  // shadow-glow-allow: trophy — 2nd place podium tier on the postable board
  2: { ring: "ring-slate-300/50", badge: "bg-slate-300/10 text-slate-200 border-slate-300/30", glow: "shadow-[0_0_32px_-14px_rgba(203,213,225,0.45)]" },
  // shadow-glow-allow: trophy — 3rd place podium tier on the postable board
  3: { ring: "ring-orange-400/50", badge: "bg-orange-400/10 text-orange-300 border-orange-400/30", glow: "shadow-[0_0_32px_-14px_rgba(251,146,60,0.45)]" },
};

export default function BoardLive() {
  // ?m=-1 shows last month (what usually gets posted right after month close).
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    const m = new URLSearchParams(window.location.search).get("m");
    if (m && !Number.isNaN(Number(m))) setOffset(Number(m));
  }, []);

  const bounds = useMemo(() => monthBounds(offset), [offset]);

  const board = useQuery({
    queryKey: ["board-live", bounds.start, bounds.end],
    // Live-tracker feel: re-pull while the board is on screen.
    refetchInterval: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("leaderboard_board" as any, {
        p_start: bounds.start,
        p_end: bounds.end,
      });
      if (error) throw error;
      return ((data ?? []) as BoardRow[]).map((r) => ({
        ...r,
        apNum: Number(r.ap ?? 0),
        dealsNum: Number(r.deals ?? 0),
        estNum: Number(r.est_earnings ?? 0),
        leadNum: Number(r.lead_cost ?? 0),
      }));
    },
  });

  const rows = board.data ?? [];
  const totalAp = rows.reduce((s, r) => s + r.apNum, 0);
  const totalDeals = rows.reduce((s, r) => s + r.dealsNum, 0);
  const totalEst = rows.reduce((s, r) => s + r.estNum, 0);
  const leader = rows[0];

  // Next milestone: round the leader up to the next 5K so there is always a
  // visible target to chase. This is a GOAL, never presented as achieved.
  const milestone = leader ? Math.ceil((leader.apNum + 1) / 5000) * 5000 : 0;
  const pct = leader && milestone ? Math.min(100, (leader.apNum / milestone) * 100) : 0;

  return (
    <div className="min-h-screen bg-background text-foreground px-4 py-8 sm:px-8">
      <div className="mx-auto w-full max-w-5xl">
        {board.isError && (
          <div role="alert" className="mb-4 rounded-lg border border-rose-500/40 bg-rose-500/10 p-4 text-sm font-semibold text-rose-200">
            Live production is temporarily unavailable. Do not post this board until it reconnects.
          </div>
        )}
        {/* header */}
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-6">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-400">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
              </span>
              Live production board
            </div>
            <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">
              APEX <span className="text-amber-400">{bounds.label}</span>
            </h1>
          </div>
          <div className="grid w-full grid-cols-3 gap-3 sm:flex sm:w-auto sm:gap-8">
            <div>
              <div className="text-[9px] uppercase tracking-widest text-muted-foreground sm:text-[11px]">Total AP</div>
              <div className="text-lg font-black tabular-nums text-foreground sm:text-3xl">
                <AnimatedCounter value={totalAp} prefix="$" />
              </div>
            </div>
            <div>
              {/* Labeled "Est." on purpose: no actual paid-commission feed exists yet
                  (agentlink_commissions + insuracloud_payouts are empty), so this is
                  contract-level math, not money confirmed paid. */}
              <div className="text-[9px] uppercase tracking-widest text-muted-foreground sm:text-[11px]">Est. earnings</div>
              <div className="text-lg font-black tabular-nums text-emerald-400 sm:text-3xl">
                <AnimatedCounter value={totalEst} prefix="$" />
              </div>
            </div>
            <div>
              <div className="text-[9px] uppercase tracking-widest text-muted-foreground sm:text-[11px]">Policies</div>
              <div className="text-lg font-black tabular-nums text-foreground sm:text-3xl">
                <AnimatedCounter value={totalDeals} />
              </div>
            </div>
          </div>
        </div>

        {/* leader milestone chase bar */}
        {leader ? (
          <div className="mt-6 rounded-xl border border-amber-400/25 bg-amber-400/5 p-4">
            <div className="flex items-center justify-between text-sm">
              <span className="font-semibold text-amber-200">
                {leader.agent_name} leads · next milestone ${money(milestone)}
              </span>
              <span className="tabular-nums text-amber-300/90">
                ${money(Math.max(milestone - leader.apNum, 0))} to go
              </span>
            </div>
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-foreground/10">
              <div
                className="h-full rounded-full bg-amber-400 transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        ) : null}

        {/* board */}
        <div className="mt-6 space-y-3">
          {board.isLoading ? (
            <div className="space-y-3">
              {[0, 1, 2, 3, 4].map((n) => (
                <div key={`sk-${n}`} className="h-24 animate-pulse rounded-xl border border-border bg-foreground/5" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <div className="rounded-xl border border-border bg-foreground/5 p-10 text-center text-muted-foreground">
              No production posted for {bounds.label} yet.
            </div>
          ) : (
            rows.map((r, i) => {
              const rank = i + 1;
              const style = RANK_STYLE[rank];
              return (
                <div
                  key={r.agent_key}
                  className={cn(
                    "relative overflow-hidden rounded-xl border border-white/10 bg-white/[0.04] p-4 transition-colors hover:bg-white/[0.07] sm:p-5",
                    style && `ring-1 ${style.ring} ${style.glow}`
                  )}
                >
                  {/* Mobile stacks (identity row, then a 3-up stat grid) so long
                      names are never truncated; from sm: it becomes one row. */}
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
                    {/* identity: rank + name + tenure */}
                    <div className="flex items-center gap-3 sm:min-w-0 sm:flex-1">
                      <div
                        className={cn(
                          "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border text-base font-black tabular-nums sm:h-11 sm:w-11 sm:text-lg",
                          style ? style.badge : "border-white/10 bg-white/5 text-muted-foreground"
                        )}
                      >
                        {rank}
                      </div>
                      <div className="min-w-0 flex-1">
                        {hasAgentProfile(r.agent_id) ? (
                          <Link
                            to={`/dashboard/profile?agentId=${encodeURIComponent(r.agent_id)}`}
                            className="block truncate text-base font-bold leading-tight text-foreground underline-offset-4 hover:text-amber-300 hover:underline sm:text-xl"
                            aria-label={`Open profile for ${r.agent_name ?? "agent"}`}
                          >
                            {r.agent_name ?? "Unknown"}
                          </Link>
                        ) : (
                          <div className="truncate text-base font-bold leading-tight text-foreground sm:text-xl">
                            {r.agent_name ?? "Unknown"}
                          </div>
                        )}
                        <div className="mt-1 flex items-center gap-2">
                          <span className="whitespace-nowrap rounded-md border border-emerald-400/30 bg-emerald-400/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-300">
                            {r.tenure_label ?? "New"}
                          </span>
                          <span className="whitespace-nowrap text-xs text-muted-foreground tabular-nums">
                            {r.dealsNum} policies
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* stats — even 3-up grid on mobile, right-aligned row on desktop */}
                    <div className="grid grid-cols-3 gap-2 border-t border-border pt-3 sm:flex sm:shrink-0 sm:items-center sm:gap-8 sm:border-0 sm:pt-0">
                      <div className="sm:text-right">
                        <div className="text-[9px] uppercase tracking-widest text-muted-foreground sm:text-[10px]">Production</div>
                        <div className="text-base font-black tabular-nums text-foreground sm:text-2xl">
                          <AnimatedCounter value={r.apNum} prefix="$" />
                        </div>
                      </div>
                      <div className="sm:text-right">
                        <div className="text-[9px] uppercase tracking-widest text-muted-foreground sm:text-[10px]">Est. income</div>
                        <div className="text-base font-black tabular-nums text-emerald-400 sm:text-2xl">
                          <AnimatedCounter value={r.estNum} prefix="$" />
                        </div>
                      </div>
                      <div className="sm:text-right">
                        <div className="text-[9px] uppercase tracking-widest text-muted-foreground sm:text-[10px]">Lead spend</div>
                        <div className="text-base font-bold tabular-nums text-muted-foreground sm:text-2xl">
                          ${money(r.leadNum)}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <p className="mt-8 border-t border-border pt-4 text-[11px] leading-relaxed text-muted-foreground">
          Production is actual posted annual premium from the carrier book. Est. income is an
          estimate based on each producer&rsquo;s contract levels and is gross of chargebacks,
          advances and overrides — individual results vary.
        </p>
      </div>
    </div>
  );
}
