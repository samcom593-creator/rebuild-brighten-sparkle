import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, TrendingUp, Target, AlertTriangle } from "lucide-react";

// Sam's $20K-per-agent-per-month target board.
// Replaces the "type in a date" production widget.
// Rows show MTD AP, projected end-of-month AP, on-pace flag,
// and money at risk = AP for deals that don't have a policy number yet.

type Row = {
  agent_id: string;
  name: string;
  email: string | null;
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
  hit_20k:        { label: "Hit $20K ✓",   cls: "bg-emerald-600/15 text-emerald-400 border-emerald-600/40" },
  on_pace_20k:    { label: "On pace",      cls: "bg-blue-600/15 text-blue-300 border-blue-600/40" },
  below_pace:     { label: "Below pace",   cls: "bg-amber-600/15 text-amber-300 border-amber-600/40" },
  new_hire_grace: { label: "New (≤30d)",   cls: "bg-zinc-600/15 text-zinc-300 border-zinc-600/40" },
  zero_mtd:       { label: "Zero this mo", cls: "bg-rose-600/15 text-rose-300 border-rose-600/40" },
};

const fmtMoney = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export function Target20kPaceWidget() {
  const { data, isLoading } = useQuery({
    queryKey: ["v_agent_20k_target_leaderboard"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_agent_20k_target_leaderboard")
        .select("*")
        .order("ap_mtd", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as Row[];
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
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

  const rows = data ?? [];
  const hit = rows.filter((r) => r.pace_verdict === "hit_20k").length;
  const onPace = rows.filter((r) => r.pace_verdict === "on_pace_20k").length;
  const apAtRiskTotal = rows.reduce((a, r) => a + (r.ap_at_risk_mtd || 0), 0);
  const apMtdTotal = rows.reduce((a, r) => a + (r.ap_mtd || 0), 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <Target className="h-5 w-5" /> $20K Pace Board
          </span>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant="outline" className="border-emerald-600/40 text-emerald-400">
              {hit} hit $20K
            </Badge>
            <Badge variant="outline" className="border-blue-600/40 text-blue-300">
              {onPace} on pace
            </Badge>
            <Badge variant="outline" className="border-rose-600/40 text-rose-300">
              {fmtMoney(apAtRiskTotal)} at risk (no policy #)
            </Badge>
            <Badge variant="outline" className="border-zinc-600/40 text-zinc-300">
              {fmtMoney(apMtdTotal)} team MTD
            </Badge>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="max-h-[480px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-background z-10 border-b">
              <tr className="text-xs uppercase text-muted-foreground">
                <th className="text-left p-2">Agent</th>
                <th className="text-right p-2">Deals</th>
                <th className="text-right p-2">AP MTD</th>
                <th className="text-right p-2">Projected EOM</th>
                <th className="text-right p-2">Gap to $20K</th>
                <th className="text-right p-2">
                  <span className="inline-flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" />At risk
                  </span>
                </th>
                <th className="text-right p-2">Pace</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const style = VERDICT_STYLE[r.pace_verdict];
                return (
                  <tr key={r.agent_id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="p-2 font-medium">{r.name}</td>
                    <td className="p-2 text-right tabular-nums">{r.deals_mtd}</td>
                    <td className="p-2 text-right tabular-nums">{fmtMoney(r.ap_mtd)}</td>
                    <td className="p-2 text-right tabular-nums text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <TrendingUp className="h-3 w-3" />
                        {fmtMoney(r.projected_eom_ap)}
                      </span>
                    </td>
                    <td className="p-2 text-right tabular-nums">
                      {r.ap_to_20k > 0 ? fmtMoney(r.ap_to_20k) : "—"}
                    </td>
                    <td className="p-2 text-right tabular-nums">
                      {r.ap_at_risk_mtd > 0 ? (
                        <span className="text-rose-300">{fmtMoney(r.ap_at_risk_mtd)}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="p-2 text-right">
                      <Badge variant="outline" className={style.cls}>
                        {style.label}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-muted-foreground">
                    No production data yet for this month.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
