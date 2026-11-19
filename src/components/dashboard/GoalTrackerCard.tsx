import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Target, TrendingUp, Users, DollarSign, CalendarClock, ClipboardList } from "lucide-react";

// MP-303 — one person's goal, the plan to hit it, and projected income, straight
// from fn_goal_scorecard. The money model is the production scoreboard's first-hop
// override (MP-328); this card never recomputes money. The period auto-resolves
// to the active goal (currently December), so the card passes no dates.

export type GoalScorecard = {
  agent_id: string | null;
  name: string | null;
  has_goal: boolean;
  period_label: string;
  upcoming: boolean;
  ended: boolean;
  own_pct: number;
  days_remaining: number;
  frac: number;
  biz_days_remaining: number;
  personal_ap_actual: number;
  team_ap_actual: number;
  team_deals_actual: number;
  team_members: number;
  recruit_actual: number;
  team_ap_goal: number;
  recruit_goal: number;
  projected_mgr_income: number | null;
  projected_total_income: number | null;
  projected_sam_override: number | null;
  pace_pct: number | null;
  needed_per_day: number | null;
  projected_eom: number | null;
  status: "ahead" | "on_track" | "behind" | "upcoming" | "hit" | "missed" | "no_goal" | "unmatched";
  avg_deal_size: number;
  deals_to_goal: number | null;
  deals_remaining: number | null;
  deals_per_week: number | null;
  deals_per_day: number | null;
  ap_per_day: number | null;
  recruits_needed: number | null;
  ap_per_recruit: number | null;
};

const money = (n: number | null | undefined) => (n == null ? "—" : `$${Math.round(n).toLocaleString()}`);
const num = (n: number | null | undefined) => (n == null ? "—" : Math.round(n).toLocaleString());

const STATUS: Record<string, { label: string; cls: string }> = {
  ahead: { label: "Ahead of pace", cls: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30" },
  on_track: { label: "On track", cls: "bg-sky-500/15 text-sky-600 border-sky-500/30" },
  behind: { label: "Behind pace", cls: "bg-amber-500/15 text-amber-600 border-amber-500/30" },
  upcoming: { label: "Starts soon", cls: "bg-primary/15 text-primary border-primary/30" },
  hit: { label: "Goal hit", cls: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30" },
  missed: { label: "Fell short", cls: "bg-rose-500/15 text-rose-600 border-rose-500/30" },
  no_goal: { label: "No goal set", cls: "bg-muted text-muted-foreground border-border" },
};

export function GoalTrackerCard({ agentId }: { agentId?: string | null }) {
  const q = useQuery({
    queryKey: ["goal-scorecard", agentId],
    enabled: !!agentId,
    staleTime: 2 * 60_000,
    queryFn: async (): Promise<GoalScorecard | null> => {
      const { data, error } = await supabase.rpc("fn_goal_scorecard", { p_agent_id: agentId as string });
      if (error) throw error;
      const card = data as unknown as GoalScorecard & { error?: string };
      if (card?.error) return null;
      return card;
    },
  });

  if (!agentId) return null;
  if (q.isLoading) return <Skeleton className="h-56 w-full rounded-xl" />;
  if (q.isError) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-base">Your goal</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">Couldn't load your goal right now. Pull to refresh.</CardContent>
      </Card>
    );
  }
  const d = q.data;
  if (!d || !d.has_goal) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Target className="h-4 w-4" /> Your goal</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          No production goal is set for you yet. Your manager or admin sets this on the team board.
        </CardContent>
      </Card>
    );
  }

  const st = STATUS[d.status] ?? STATUS.no_goal;
  const pct = Math.max(0, Math.min(100, d.team_ap_goal > 0 ? (d.team_ap_actual / d.team_ap_goal) * 100 : 0));
  const paceTarget = d.team_ap_goal * d.frac;

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2"><Target className="h-4 w-4 text-primary" /> {d.period_label} goal</CardTitle>
          <Badge variant="outline" className={st.cls}>{st.label}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <div className="flex items-baseline justify-between text-sm">
            <span className="font-semibold">{money(d.team_ap_actual)}</span>
            <span className="text-muted-foreground">of {money(d.team_ap_goal)} ALP</span>
          </div>
          <Progress value={pct} className="h-2 mt-1.5" />
          <div className="flex items-center justify-between mt-1.5 text-xs text-muted-foreground">
            {d.upcoming ? (
              <span className="flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5" /> Starts {d.period_label} · {d.biz_days_remaining} selling days</span>
            ) : (
              <>
                <span>{d.pace_pct == null ? "—" : `${d.pace_pct}% of pace`}</span>
                <span>Should be at {money(paceTarget)} today</span>
              </>
            )}
          </div>
        </div>

        {/* The plan to hit it */}
        <div className="rounded-lg border border-primary/25 bg-primary/5 p-3">
          <div className="flex items-center gap-1.5 text-xs font-medium text-primary mb-2">
            <ClipboardList className="h-3.5 w-3.5" /> What it takes
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <div>
              <div className="text-xs text-muted-foreground">Deals to goal</div>
              <div className="font-semibold">{num(d.deals_remaining)}<span className="text-xs font-normal text-muted-foreground"> left of {num(d.deals_to_goal)}</span></div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">At your avg deal</div>
              <div className="font-semibold">{money(d.avg_deal_size)}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Per week</div>
              <div className="font-semibold">{d.deals_per_week == null ? "—" : `${d.deals_per_week} deals`}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Per selling day</div>
              <div className="font-semibold">{d.deals_per_day == null ? "—" : `${d.deals_per_day} deals`}<span className="text-xs font-normal text-muted-foreground"> · {money(d.ap_per_day)}</span></div>
            </div>
            {d.recruit_goal > 0 && (
              <div className="col-span-2 pt-1 border-t border-primary/15 flex items-center gap-1.5 text-xs">
                <Users className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-muted-foreground">Build your team:</span>
                <span className="font-semibold text-foreground">{d.recruits_needed} more agent{d.recruits_needed === 1 ? "" : "s"}</span>
                <span className="text-muted-foreground">at ~{money(d.ap_per_recruit)} each ({d.recruit_actual}/{d.recruit_goal} so far)</span>
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          {!d.upcoming && (
            <div className="rounded-lg border border-border/60 bg-muted/20 p-2.5">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><TrendingUp className="h-3.5 w-3.5" /> On pace to finish</div>
              <div className="font-semibold mt-0.5">{money(d.projected_eom)}</div>
            </div>
          )}
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-2.5">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><DollarSign className="h-3.5 w-3.5" /> Your income at goal</div>
            <div className="font-semibold mt-0.5 text-primary">{money(d.projected_total_income)}</div>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground leading-snug">
          Projected income is an estimate at your {d.own_pct}% contract if you hit {money(d.team_ap_goal)} in ALP.
          {d.team_members > 0 ? ` Includes override on your ${d.team_members}-agent team.` : ""}
        </p>
      </CardContent>
    </Card>
  );
}
