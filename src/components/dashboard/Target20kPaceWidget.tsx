import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { GoalProgressRail } from "@/components/ui/kpi-stat";
import { Loader2, Target, AlertTriangle } from "lucide-react";
import { useBusinessToday } from "@/hooks/useBusinessToday";
import { useDemoNumberFields } from "@/hooks/useDemoNumberFields";
import { applyTarget20kDemo, target20kDemoFields } from "@/lib/goalDemoModels";
import "./dashboard-content.css";

// Sam's $20K-per-agent-per-month target board.
// Replaces the "type in a date" production widget.
// Rows show MTD AP, projected end-of-month AP, on-pace flag,
// and money at risk = AP for deals that don't have a policy number yet.

type Row = {
  agent_id: string;
  name: string;
  license_status: string | null;
  hired: string | null;
  deals_mtd: number;
  ap_mtd: number;
  deals_no_policy_mtd: number;
  ap_at_risk_mtd: number;
  ap_to_20k: number;
  projected_eom_ap: number;
  pace_verdict:
    | "hit_20k"
    | "on_pace_20k"
    | "below_pace"
    | "new_hire_grace"
    | "zero_mtd";
};

const VERDICT_STYLE: Record<Row["pace_verdict"], { label: string; cls: string }> = {
  hit_20k:        { label: "Hit $20K",     cls: "bg-tone-good/10 text-tone-good border-tone-good/35" },
  on_pace_20k:    { label: "On pace",      cls: "bg-tone-cool/10 text-tone-cool border-tone-cool/35" },
  below_pace:     { label: "Below pace",   cls: "bg-tone-warm/10 text-tone-warm border-tone-warm/35" },
  new_hire_grace: { label: "New · 30 days", cls: "bg-muted text-muted-foreground border-border" },
  zero_mtd:       { label: "No ALP yet",  cls: "bg-muted text-muted-foreground border-border" },
};

const fmtMoney = (n: number | null | undefined) => n != null && Number.isFinite(n)
  ? n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }) : "—";
const fmtCount = (n: number | null | undefined) => n != null && Number.isFinite(n) ? n.toLocaleString("en-US") : "—";

export function Target20kPaceWidget() {
  const today = useBusinessToday();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["v_agent_20k_target_leaderboard"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_agent_20k_target_leaderboard")
        .select("agent_id, name, license_status, hired, deals_mtd, ap_mtd, deals_no_policy_mtd, ap_at_risk_mtd, ap_to_20k, projected_eom_ap, pace_verdict")
        .order("ap_mtd", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as Row[];
    },
    refetchInterval: 300_000,
    staleTime: 30_000,
  });
  const demo = useDemoNumberFields({
    scopeKey: `target20k:${today.slice(0, 7)}`,
    label: "$20K pace board · current month",
    fields: isError || isLoading ? [] : target20kDemoFields(data),
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="h-5 w-5" /> $20K Pace Board
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    // Feed error, never a fake "$0 team MTD / No production data yet". A dead
    // v_agent_20k_target_leaderboard view (queryFn throws → data undefined →
    // rows []) would otherwise render the AUTHORITATIVE "$0 team MTD · 0 hit
    // $20K · $0 at risk" badges + "No production data yet for this month." —
    // a confident agency-wide zero on Sam's highest-visibility $20K money board
    // at the exact moment the feed merely died. The 465-InsuraCloud fake-success
    // class; surface the error instead (MP-WIB-ADMIN-RENDER-HEALTH).
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="h-5 w-5" /> $20K Pace Board
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-4 text-sm text-rose-600 dark:text-rose-400">
            <span className="inline-flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              $20K pace board is temporarily unavailable. This is a feed error,
              not $0 production — don't read it as "no one posted this month."
            </span>
          </div>
        </CardContent>
      </Card>
    );
  }

  const rows = demo.isDemo ? applyTarget20kDemo(data ?? [], demo.values) : data ?? [];
  return <Target20kBoardView rows={rows} isDemo={demo.isDemo} />;
}

/** Existing rows only; the demo adapter and visual QA use this same presentation. */
export function Target20kBoardView({ rows, isDemo = false }: { rows: readonly Row[]; isDemo?: boolean }) {
  const hit = rows.filter((r) => r.pace_verdict === "hit_20k").length;
  const onPace = rows.filter((r) => r.pace_verdict === "on_pace_20k").length;
  const apAtRiskTotal = rows.every((r) => Number.isFinite(r.ap_at_risk_mtd)) ? rows.reduce((a, r) => a + r.ap_at_risk_mtd, 0) : null;
  const apMtdTotal = rows.every((r) => Number.isFinite(r.ap_mtd)) ? rows.reduce((a, r) => a + r.ap_mtd, 0) : null;
  const ranked = [...rows].sort((a, b) => (Number.isFinite(b.ap_mtd) ? b.ap_mtd : -1) - (Number.isFinite(a.ap_mtd) ? a.ap_mtd : -1) || a.agent_id.localeCompare(b.agent_id));

  return (
    <Card className="money-board money-board--target">
      <CardHeader className="money-board__header">
        <div className="money-board__heading">
          <div>
            <p className="money-board__eyebrow"><Target className="h-4 w-4" aria-hidden="true" /> Monthly producer target</p>
            <CardTitle className="money-board__title">$20K pace board</CardTitle>
          </div>
          <div className="money-board__actions">
            {isDemo && <Badge variant="outline" role="status">Demo figures</Badge>}
            <Badge variant="outline" className="border-tone-good/35 text-tone-good">{hit} hit goal</Badge>
            <Badge variant="outline" className="border-tone-cool/35 text-tone-cool">{onPace} on pace</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="money-board__overview">
          <div className="money-board__stat money-board__stat--lead"><p>Shown agents · MTD</p><strong>{fmtMoney(apMtdTotal)}</strong><span>ALP · {rows.length} agents shown</span></div>
          <div className="money-board__stat"><p>Monthly target / agent</p><strong>$20,000</strong><span>ALP</span></div>
          <div className="money-board__stat money-board__stat--estimate"><p>Needs policy number</p><strong>{fmtMoney(apAtRiskTotal)}</strong><span>ALP on the shown rows</span></div>
        </div>
        <div className="target-pace-board__rows" tabIndex={0} role="region" aria-label="Pace to $20K">
          <ol aria-label="Producer pace rankings">
            {ranked.map((r) => {
              const style = VERDICT_STYLE[r.pace_verdict] ?? { label: "Pace unavailable", cls: "text-muted-foreground" };
              const rank = Number.isFinite(r.ap_mtd) && r.ap_mtd > 0 ? ranked.findIndex((row) => row.ap_mtd === r.ap_mtd) + 1 : null;
              return (
                <li key={r.agent_id} className="target-pace-board__producer">
                  <header className="money-board__row-heading">
                    <div className="target-pace-board__identity"><span className="target-pace-board__rank" aria-label={rank ? `Rank ${rank}` : "No production rank"}>{rank ? String(rank).padStart(2, "0") : "—"}</span><h3>{r.name}</h3></div>
                    <Badge variant="outline" className={style.cls}>{style.label}</Badge>
                  </header>
                  <div className="money-board__amount-pair">
                    <p className="money-board__row-amount">{fmtMoney(r.ap_mtd)}<span>ALP MTD</span></p>
                    <p className="money-board__goal-value"><strong>{fmtCount(r.deals_mtd)}</strong> posted deals</p>
                  </div>
                  <GoalProgressRail actual={r.ap_mtd} target={20000} label={`${r.name} progress to $20,000 ALP`} />
                  <details className="money-board__details">
                    <summary>Projection & policy details</summary>
                    <dl className="goal-board__detail-grid">
                      <div><dt>Projected month-end ALP</dt><dd>{fmtMoney(r.projected_eom_ap)}</dd></div>
                      <div><dt>Remaining to $20,000</dt><dd>{fmtMoney(r.ap_to_20k)}</dd></div>
                      <div><dt>ALP missing policy numbers</dt><dd>{fmtMoney(r.ap_at_risk_mtd)}</dd></div>
                      <div><dt>Deals missing policy numbers</dt><dd>{fmtCount(r.deals_no_policy_mtd)}</dd></div>
                    </dl>
                    <p className="money-board__note">Projection is an estimate at the current pace. Missing policy numbers do not establish a loss.</p>
                  </details>
                </li>
              );
            })}
          </ol>
          {rows.length === 0 && <p className="money-board__empty">No production data yet for this month.</p>}
        </div>
        <p className="money-board__footnote">Current-month posted ALP · up to 100 agents shown · annualized premium, not income.</p>
      </CardContent>
    </Card>
  );
}
