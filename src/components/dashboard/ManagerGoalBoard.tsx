import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Target, ExternalLink } from "lucide-react";
import type { GoalScorecard } from "./GoalTrackerCard";

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

const money = (n: number | null | undefined) => (n == null ? "—" : `$${Math.round(n).toLocaleString()}`);

const STATUS: Record<string, string> = {
  ahead: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30",
  on_track: "bg-sky-500/15 text-sky-600 border-sky-500/30",
  behind: "bg-amber-500/15 text-amber-600 border-amber-500/30",
  upcoming: "bg-primary/15 text-primary border-primary/30",
  hit: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30",
  missed: "bg-rose-500/15 text-rose-600 border-rose-500/30",
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
  const b = q.data;
  if (!b || b.managers.length === 0) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Target className="h-4 w-4" /> Manager goal tracker</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">No manager goals set yet.</CardContent>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2"><Target className="h-4 w-4 text-primary" /> Manager goal tracker · {b.period_label}</CardTitle>
          <Button asChild variant="ghost" size="sm" className="h-7 text-xs">
            <a href="https://mgnagenthub.com/downlines" target="_blank" rel="noopener noreferrer">Contracting <ExternalLink className="ml-1 h-3 w-3" /></a>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2.5">
        {b.managers.map((m, i) => {
          const pct = Math.max(0, Math.min(100, m.team_ap_goal > 0 ? ((m.team_ap_actual ?? 0) / m.team_ap_goal) * 100 : 0));
          return (
            <div key={m.agent_id ?? `u-${i}`} className="rounded-lg border border-border/60 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-semibold truncate">{m.name}</span>
                  <Badge variant="outline" className={`text-[10px] ${STATUS[m.status] ?? STATUS.no_goal}`}>{STATUS_LABEL[m.status] ?? "—"}</Badge>
                </div>
                {m.agent_id && (
                  <Link to={`/dashboard/agent/${m.agent_id}`} className="text-xs text-muted-foreground hover:text-foreground shrink-0">Open →</Link>
                )}
              </div>
              {m.unmatched ? (
                <div className="mt-1 text-xs text-muted-foreground">
                  Goal {money(m.team_ap_goal)}{m.recruit_goal ? ` · ${m.recruit_goal} agents` : ""} — not matched to a roster agent yet.
                </div>
              ) : (
                <>
                  <div className="mt-2 flex items-baseline justify-between text-sm">
                    <span className="font-medium">{money(m.team_ap_actual)}</span>
                    <span className="text-muted-foreground text-xs">of {money(m.team_ap_goal)}{m.pace_pct != null ? ` · ${m.pace_pct}% pace` : ""}</span>
                  </div>
                  <Progress value={pct} className="h-1.5 mt-1" />
                  {/* the plan */}
                  <div className="mt-1.5 text-[11px] text-muted-foreground">
                    Needs <span className="text-foreground font-medium">{m.deals_per_week ?? "—"} deals/wk</span> ({m.deals_per_day ?? "—"}/day at {money(m.avg_deal_size)})
                    {m.recruit_goal ? <> · <span className="text-foreground font-medium">{m.recruits_needed} more agents</span></> : null}
                    {m.biz_days_remaining != null ? ` · ${m.biz_days_remaining} selling days` : ""}
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <div className="text-muted-foreground">Team</div>
                      <div className="font-medium">{m.team_members ?? 0}{m.recruit_goal ? ` / ${m.recruit_goal}` : ""}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Their income</div>
                      <div className="font-medium">{money(m.projected_total_income)}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Your override</div>
                      <div className="font-medium text-primary">{money(m.projected_sam_override)}</div>
                    </div>
                  </div>
                </>
              )}
            </div>
          );
        })}

        <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 mt-1">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <div className="text-[11px] text-muted-foreground">Team goal</div>
              <div className="font-semibold">{money(b.total_team_goal)}</div>
            </div>
            <div>
              <div className="text-[11px] text-muted-foreground">Booked so far</div>
              <div className="font-semibold">{money(b.total_team_actual)}</div>
            </div>
            <div>
              <div className="text-[11px] text-muted-foreground">Your income at goal</div>
              <div className="font-semibold text-primary">{money(b.total_projected_sam_override)}</div>
            </div>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground leading-snug">
          Your income at goal = each tree's ALP goal × your contract spread over that manager. An estimate at current comp, not a guarantee.
        </p>
      </CardContent>
    </Card>
  );
}
