import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { GoalProgressRail } from "@/components/ui/kpi-stat";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Target, ExternalLink } from "lucide-react";
import { useDemoNumberFields } from "@/hooks/useDemoNumberFields";
import { applyManagerGoalDemo, managerGoalDemoFields } from "@/lib/goalDemoModels";
import type { GoalScorecard } from "./GoalTrackerCard";
import "./dashboard-content.css";

// MP-303 — Sam's manager track board. Every manager's goal, what it takes to hit
// it, their projected income, and Sam's projected override from their tree, plus
// totals. One read of fn_owner_goal_board (first-hop override money, MP-328); the
// period auto-resolves to the active goal (currently December).

type Board = {
  period_label: string;
  period_start: string;
  managers: (GoalScorecard & { unmatched?: boolean })[];
  total_team_goal: number;
  total_team_actual: number;
  total_projected_sam_override: number;
  total_projected_mgr_income: number;
  error?: string;
};

const money = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "—" : `$${Math.round(n).toLocaleString("en-US")}`);

const STATUS: Record<string, string> = {
  ahead: "bg-tone-good/10 text-tone-good border-tone-good/35",
  on_track: "bg-tone-cool/10 text-tone-cool border-tone-cool/35",
  behind: "bg-tone-warm/10 text-tone-warm border-tone-warm/35",
  upcoming: "bg-primary/15 text-primary border-primary/30",
  hit: "bg-tone-good/10 text-tone-good border-tone-good/35",
  missed: "bg-tone-hot/10 text-tone-hot border-tone-hot/35",
  no_goal: "bg-muted text-muted-foreground border-border",
  unmatched: "bg-muted text-muted-foreground border-dashed border-border",
};
const STATUS_LABEL: Record<string, string> = {
  ahead: "Ahead", on_track: "On track", behind: "Behind", upcoming: "Starts soon",
  hit: "Hit", missed: "Short", no_goal: "No goal", unmatched: "Not in roster",
};

export function ManagerGoalBoard() {
  // WIB Check #6/#8 (MP-WIB-GOAL-BOARD-DEFER-FIX, supersedes MP-WIB-GOAL-BOARD-
  // DEFER / 7966a814): fn_owner_goal_board is a ≈3.9s server RPC (7 managers ×
  // ~40 canonical-production scans, recomputed live). This card is admin-only
  // and sits below the fold on Home, so it should never fetch on the initial
  // page-load burst. The first defer attempt armed an IntersectionObserver AT
  // MOUNT — but at mount the WHOLE Home page is skeletons and short, so this
  // below-fold card momentarily sits inside the viewport and the observer's
  // first synthetic callback reports it visible. It fired anyway (prod waterfall:
  // the RPC started at +1174ms, right as the lazy chunk mounted, and held
  // network-idle open to 6.8s).
  //
  // Fix: don't measure visibility against the mount-time collapsed layout. Arm
  // the scroll observer only AFTER the above-the-fold burst has settled
  // (SETTLE_MS, past the ~2.8s first network-idle measured without this RPC), by
  // which point real content has pushed this card to its true below-the-fold
  // position. Because the observer cannot fire before SETTLE_MS, the RPC is off
  // the first-screen critical path by construction — the KPI win is independent
  // of scroll position and viewport geometry, not a guess about where the card
  // lands. A no-scroll load never fetches it; a scroll fetches it then; the
  // backstop guarantees an owner who never scrolls still gets the board, well
  // after the first screen has settled. No IntersectionObserver -> eager (SSR).
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(typeof IntersectionObserver === "undefined");
  useEffect(() => {
    if (inView) return;
    const SETTLE_MS = 3000;   // > the ~2.8s first network-idle (burst end + 500ms)
    const BACKSTOP_MS = 12000; // non-scroller still gets the board, off critical path
    let io: IntersectionObserver | null = null;
    const arm = window.setTimeout(() => {
      const el = ref.current;
      if (!el) { setInView(true); return; }
      io = new IntersectionObserver(
        (entries) => { if (entries.some((e) => e.isIntersecting)) { setInView(true); io?.disconnect(); } },
        { rootMargin: "300px" },
      );
      io.observe(el);
    }, SETTLE_MS);
    const backstop = window.setTimeout(() => setInView(true), BACKSTOP_MS);
    return () => { window.clearTimeout(arm); window.clearTimeout(backstop); io?.disconnect(); };
  }, [inView]);

  const q = useQuery({
    queryKey: ["owner-goal-board"],
    staleTime: 2 * 60_000,
    enabled: inView,
    queryFn: async (): Promise<Board | null> => {
      const { data, error } = await supabase.rpc("fn_owner_goal_board", {});
      if (error) throw error;
      const b = data as unknown as Board;
      if (b?.error) return null;
      return b;
    },
  });
  const demo = useDemoNumberFields({
    scopeKey: `manager-goals:${q.data?.period_start ?? "pending"}`,
    label: `Team goals · ${q.data?.period_label ?? "current period"}`,
    fields: q.isError || q.isPending ? [] : managerGoalDemoFields(q.data),
  });

  // isPending covers both the pre-view idle state (enabled:false) and the
  // in-flight fetch; the ref must stay mounted through both so the observer can
  // fire. Cached data (react-query, 2min) renders instantly with no refetch.
  if (q.isPending) return <div ref={ref}><Skeleton className="h-64 w-full rounded-xl" /></div>;
  if (q.isError) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-base">Manager goal tracker</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">Couldn't load the goal board right now.</CardContent>
      </Card>
    );
  }
  const b = demo.isDemo ? applyManagerGoalDemo(q.data, demo.values) : q.data;
  if (!b || b.managers.length === 0) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Target className="h-4 w-4" /> Manager goal tracker</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">No manager goals set yet.</CardContent>
      </Card>
    );
  }

  return <ManagerGoalBoardView board={b} isDemo={demo.isDemo} />;
}

/** Pure rendering seam shared by the live query, demo adapter and visual QA. */
export function ManagerGoalBoardView({ board: b, isDemo = false }: { board: Board; isDemo?: boolean }) {
  return (
    <Card className="money-board money-board--goals">
      <CardHeader className="money-board__header">
        <div className="money-board__heading">
          <div>
            <p className="money-board__eyebrow"><Target className="h-4 w-4" aria-hidden="true" /> {b.period_label} · saved goals</p>
            <CardTitle className="money-board__title">Team goals</CardTitle>
          </div>
          <div className="money-board__actions">
            {isDemo && <Badge variant="outline" role="status">Demo figures</Badge>}
            <Button asChild variant="outline" size="sm" className="min-h-11">
              <a href="https://mgnagenthub.com/downlines" target="_blank" rel="noopener noreferrer">Contracting <ExternalLink className="ml-1 h-4 w-4" /></a>
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="money-board__overview">
          <div className="money-board__stat money-board__stat--lead"><p>Posted ALP</p><strong>{money(b.total_team_actual)}</strong><span>Manager teams · {b.period_label}</span></div>
          <div className="money-board__stat"><p>Combined goal</p><strong>{money(b.total_team_goal)}</strong><span>ALP target</span></div>
          <div className="money-board__stat money-board__stat--estimate"><p>Est. override at goal</p><strong>{money(b.total_projected_sam_override)}</strong><span>At current contract spreads</span></div>
        </div>
        <div className="goal-board__rows">
          {b.managers.map((m, i) => (
            <article key={m.agent_id ?? `u-${i}`} className="goal-board__manager" aria-label={`${m.name ?? "Unmatched manager"} goal`}>
              <header className="money-board__row-heading">
                <div className="min-w-0"><h3>{m.name}</h3><Badge variant="outline" className={STATUS[m.status] ?? STATUS.no_goal}>{STATUS_LABEL[m.status] ?? "Status unavailable"}</Badge></div>
                {m.agent_id && <Link to={`/dashboard/agent/${m.agent_id}`} className="money-board__open">Open <span aria-hidden="true">↗</span></Link>}
              </header>
              {m.unmatched ? (
                <div className="mt-4"><p className="money-board__row-amount">{money(m.team_ap_goal)}</p><p className="money-board__note">ALP goal · not matched to a roster agent yet{m.recruit_goal ? ` · ${m.recruit_goal} recruiting goal` : ""}</p></div>
              ) : (
                <>
                  <div className="money-board__amount-pair">
                    <p className="money-board__row-amount">{money(m.team_ap_actual)}<span>ALP</span></p>
                    <p className="money-board__goal-value">Goal <strong>{money(m.team_ap_goal)}</strong></p>
                  </div>
                  <GoalProgressRail actual={m.team_ap_actual} target={m.team_ap_goal} paceFraction={!m.upcoming && !m.ended ? m.frac : null} label={`${m.name ?? "Manager"} production goal`} />
                  <div className="goal-board__essentials">
                    <span><strong>{m.team_ap_goal > 0 && m.team_ap_actual != null ? money(Math.max(0, m.team_ap_goal - m.team_ap_actual)) : "—"}</strong> to goal</span>
                    <span><strong>{m.biz_days_remaining ?? "—"}</strong> selling days left</span>
                  </div>
                  <details className="money-board__details">
                    <summary>Plan & estimates</summary>
                    <dl className="goal-board__detail-grid">
                      <div><dt>Deals per week</dt><dd>{m.deals_per_week ?? "—"}</dd></div>
                      <div><dt>Deals per selling day</dt><dd>{m.deals_per_day ?? "—"}</dd></div>
                      <div><dt>Average deal</dt><dd>{money(m.avg_deal_size)} ALP</dd></div>
                      <div><dt>Team members</dt><dd>{m.team_members ?? "—"}</dd></div>
                      <div><dt>New hires in goal period</dt><dd>{m.recruit_actual ?? "—"}{m.recruit_goal ? ` / ${m.recruit_goal} goal` : ""}</dd></div>
                      <div><dt>Hires still needed</dt><dd>{m.recruits_needed ?? "—"}</dd></div>
                      <div><dt>Manager est. income at goal</dt><dd>{money(m.projected_total_income)}</dd></div>
                      <div><dt>Your est. override at goal</dt><dd>{money(m.projected_sam_override)}</dd></div>
                      <div><dt>Pace against target</dt><dd>{m.pace_pct != null ? `${m.pace_pct}%` : "—"}</dd></div>
                    </dl>
                  </details>
                </>
              )}
            </article>
          ))}
        </div>
        <p className="money-board__footnote">Income and override are estimates at goal using current contract spreads.</p>
      </CardContent>
    </Card>
  );
}
