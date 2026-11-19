import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Target, TrendingUp, Users, DollarSign } from "lucide-react";

// MP-303 — one person's goal, pace and projected income, from fn_goal_scorecard.
// Numbers come straight from the SQL computor (same first-hop money model as the
// production scoreboard, MP-328). This card never recomputes money in the client.

export type GoalScorecard = {
  agent_id: string | null;
  name: string | null;
  has_goal: boolean;
  own_pct: number;
  days_total: number;
  days_elapsed: number;
  days_remaining: number;
  frac: number;
  personal_ap_actual: number;
  team_ap_actual: number;
  team_members: number;
  recruit_actual: number;
  team_ap_goal: number;
  recruit_goal: number;
  label: string | null;
  projected_mgr_income: number | null;
  projected_total_income: number | null;
  projected_sam_override: number | null;
  pace_pct: number | null;
  needed_per_day: number | null;
  projected_eom: number | null;
  status: "ahead" | "on_track" | "behind" | "no_goal" | "unmatched";
};

const money = (n: number | null | undefined) =>
  n == null ? "—" : `$${Math.round(n).toLocaleString()}`;

function phoenixMonth(): { start: string; end: string; label: string } {
  // America/Phoenix has no DST; format the current month's bounds from a Phoenix clock.
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Phoenix" }));
  const y = now.getFullYear();
  const m = now.getMonth();
  const start = new Date(y, m, 1);
  const end = new Date(y, m + 1, 0);
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { start: iso(start), end: iso(end), label: start.toLocaleString("en-US", { month: "long", year: "numeric" }) };
}

const STATUS: Record<string, { label: string; cls: string }> = {
  ahead: { label: "Ahead of pace", cls: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30" },
  on_track: { label: "On track", cls: "bg-sky-500/15 text-sky-600 border-sky-500/30" },
  behind: { label: "Behind pace", cls: "bg-amber-500/15 text-amber-600 border-amber-500/30" },
  no_goal: { label: "No goal set", cls: "bg-muted text-muted-foreground border-border" },
};

export function GoalTrackerCard({ agentId, period }: { agentId?: string | null; period?: { start: string; end: string; label: string } }) {
  const p = useMemo(() => period ?? phoenixMonth(), [period]);
  const q = useQuery({
    queryKey: ["goal-scorecard", agentId, p.start, p.end],
    enabled: !!agentId,
    staleTime: 2 * 60_000,
    queryFn: async (): Promise<GoalScorecard | null> => {
      const { data, error } = await supabase.rpc("fn_goal_scorecard", {
        p_agent_id: agentId as string,
        p_period_start: p.start,
        p_period_end: p.end,
      });
      if (error) throw error;
      const card = data as unknown as GoalScorecard & { error?: string };
      if (card?.error) return null;
      return card;
    },
  });

  if (!agentId) return null;
  if (q.isLoading) return <Skeleton className="h-48 w-full rounded-xl" />;
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
          No production goal is set for {p.label} yet. Your manager or admin sets this on the team board.
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
          <CardTitle className="text-base flex items-center gap-2"><Target className="h-4 w-4 text-primary" /> {p.label} goal</CardTitle>
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
            <span>{d.pace_pct == null ? "—" : `${d.pace_pct}% of pace`}</span>
            <span>Should be at {money(paceTarget)} today</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-lg border border-border/60 bg-muted/20 p-2.5">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><TrendingUp className="h-3.5 w-3.5" /> Write per day to finish</div>
            <div className="font-semibold mt-0.5">{money(d.needed_per_day)}<span className="text-xs font-normal text-muted-foreground"> · {d.days_remaining}d left</span></div>
          </div>
          <div className="rounded-lg border border-border/60 bg-muted/20 p-2.5">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><TrendingUp className="h-3.5 w-3.5" /> On pace to finish</div>
            <div className="font-semibold mt-0.5">{money(d.projected_eom)}</div>
          </div>
          {d.recruit_goal > 0 && (
            <div className="rounded-lg border border-border/60 bg-muted/20 p-2.5">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Users className="h-3.5 w-3.5" /> Recruits</div>
              <div className="font-semibold mt-0.5">{d.recruit_actual}<span className="text-xs font-normal text-muted-foreground"> of {d.recruit_goal}</span></div>
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
