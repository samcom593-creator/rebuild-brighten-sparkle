import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, ArrowRight, Compass, TrendingDown, TrendingUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

type FunnelRow = {
  stage_key: string;
  order_index: number | null;
  display_name: string;
  in_stage: number;
  stalled: number;
  median_days: number | null;
  avg_days: number | null;
  next_stage_count: number | null;
  conversion_to_next_pct: number | null;
};

type MessageStat = {
  channel: string;
  sent: number;
  failed: number;
};

export default function AdminFunnelHealth() {
  const { data: funnel = [], isLoading: funnelLoading } = useQuery<FunnelRow[]>({
    queryKey: ["next-step-funnel-health"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_next_step_funnel_health")
        .select("*")
        .order("order_index", { ascending: true });
      if (error) throw error;
      return (data as FunnelRow[]) ?? [];
    },
    staleTime: 60_000,
    refetchInterval: 300_000 * 60_000,
  });

  const { data: msgStats = [] } = useQuery<MessageStat[]>({
    queryKey: ["next-step-message-stats"],
    queryFn: async () => {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase.rpc("next_step_message_stats_24h" as any, { since_ts: since }).then((r) => r);
      if (error || !data) {
        // Fallback: do it client-side if the RPC doesn't exist.
        const { data: rows } = await supabase
          .from("next_step_messages")
          .select("channel, sent_at, failed_at")
          .gte("created_at", since)
          .limit(2000);
        const map: Record<string, MessageStat> = {};
        for (const r of rows ?? []) {
          const ch = (r as any).channel ?? "unknown";
          if (!map[ch]) map[ch] = { channel: ch, sent: 0, failed: 0 };
          if ((r as any).sent_at) map[ch].sent++;
          if ((r as any).failed_at) map[ch].failed++;
        }
        return Object.values(map).sort((a, b) => b.sent - a.sent);
      }
      return data as MessageStat[];
    },
    staleTime: 60_000,
    refetchInterval: 300_000 * 60_000,
  });

  const totals = useMemo(() => {
    const inFunnel = funnel.filter((r) => (r.order_index ?? 0) > 0 && (r.order_index ?? 0) <= 18);
    return {
      total_people: inFunnel.reduce((a, r) => a + r.in_stage, 0),
      stalled: inFunnel.reduce((a, r) => a + r.stalled, 0),
      active_stages: inFunnel.length,
      msg_sent_24h: msgStats.reduce((a, r) => a + r.sent, 0),
      msg_failed_24h: msgStats.reduce((a, r) => a + r.failed, 0),
    };
  }, [funnel, msgStats]);

  // Biggest leak = the stage with the most STALLED people (the same signal the
  // table shows). Previously this used in_stage - next_stage_count, which mixes
  // two non-sequential cohorts and disagreed with the table's Stalled column.
  const biggestLeak = useMemo(() => {
    let best: { row: FunnelRow; loss: number } | null = null;
    for (const r of funnel) {
      if (!r.order_index || r.order_index >= 18 || r.in_stage === 0) continue;
      const stalled = r.stalled ?? 0;
      if (stalled <= 0) continue;
      if (!best || stalled > best.loss) best = { row: r, loss: stalled };
    }
    return best;
  }, [funnel]);

  return (
    <div className="container mx-auto px-4 py-8 space-y-6 max-w-7xl">
      <div>
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-1">
          <Compass className="h-3.5 w-3.5" /> Pipeline · Funnel Health
        </div>
        <h1 className="text-3xl font-bold">Next-Step Funnel Health</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Conversion-to-next-stage + median time-in-stage for every cohort. The bigger the drop, the bigger the leak.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <KpiTile label="In funnel" value={totals.total_people} tone="blue" />
        <KpiTile label="Stalled" value={totals.stalled} tone={totals.stalled > 100 ? "rose" : "amber"} />
        <KpiTile label="Active stages" value={totals.active_stages} tone="neutral" />
        <KpiTile label="Msgs sent 24h" value={totals.msg_sent_24h} tone="emerald" />
        <KpiTile label="Msgs failed 24h" value={totals.msg_failed_24h} tone={totals.msg_failed_24h > 5 ? "rose" : "amber"} />
      </div>

      {biggestLeak && (
        <Card className="border-rose-500/40 bg-rose-500/5">
          <CardContent className="p-5">
            <div className="flex items-start gap-3">
              <div className="rounded-md bg-rose-500/15 p-3 border border-rose-500/30 shrink-0">
                <TrendingDown className="h-5 w-5 text-rose-300" />
              </div>
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-[0.18em] text-rose-400/80">Biggest concentrated leak</div>
                <div className="text-lg font-bold mt-0.5">
                  {biggestLeak.loss} people stalled at "{biggestLeak.row.display_name}"
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  These have sat in this stage past the expected window. Median time in stage is {biggestLeak.row.median_days ?? "—"}d.
                </p>
                <Link
                  to={`/admin/next-step/stuck?stage=${biggestLeak.row.stage_key}`}
                  className="text-sm hover:underline text-rose-300 inline-flex items-center gap-1 mt-2"
                >
                  Triage this cohort <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Stage-by-stage cohort + conversion</CardTitle>
        </CardHeader>
        <CardContent>
          {funnelLoading ? (
            <div className="py-10 text-center text-muted-foreground">Loading funnel health...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border/50">
                    <th className="text-left py-2 px-2">#</th>
                    <th className="text-left py-2 px-2">Stage</th>
                    <th className="text-right py-2 px-2">People</th>
                    <th className="text-right py-2 px-2">Stalled</th>
                    <th className="text-right py-2 px-2">Median (d)</th>
                    <th className="text-right py-2 px-2">→ Next</th>
                    <th className="text-right py-2 px-2">Conv. %</th>
                  </tr>
                </thead>
                <tbody>
                  {funnel.map((r) => {
                    const isTerminal = (r.order_index ?? 0) >= 18 || (r.order_index ?? 0) === 0;
                    const conv = r.conversion_to_next_pct;
                    const convClass = conv == null ? "text-muted-foreground"
                      : conv < 20 ? "text-rose-400"
                      : conv < 50 ? "text-amber-400"
                      : "text-emerald-400";
                    return (
                      <tr key={r.stage_key} className="border-b border-border/30 hover:bg-muted/30">
                        <td className="py-2 px-2 tabular-nums text-muted-foreground">{r.order_index ?? "—"}</td>
                        <td className="py-2 px-2 font-medium">
                          <Link to={`/admin/next-step/stuck?stage=${r.stage_key}`} className="hover:underline">
                            {r.display_name}
                          </Link>
                        </td>
                        <td className="py-2 px-2 text-right tabular-nums">{r.in_stage}</td>
                        <td className="py-2 px-2 text-right tabular-nums">
                          {r.stalled > 0 ? (
                            <Badge variant="destructive" className="text-[10px]">
                              {r.stalled}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="py-2 px-2 text-right tabular-nums text-muted-foreground">{r.median_days ?? "—"}</td>
                        <td className="py-2 px-2 text-right tabular-nums text-muted-foreground">
                          {isTerminal ? "—" : (r.next_stage_count ?? 0)}
                        </td>
                        <td className={cn("py-2 px-2 text-right tabular-nums font-semibold", convClass)}>
                          {isTerminal ? "—" : (conv != null ? `${conv}%` : "—")}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Outbound messages (last 24h)</CardTitle>
        </CardHeader>
        <CardContent>
          {msgStats.length === 0 ? (
            <div className="py-6 text-center text-muted-foreground">No messages dispatched in the last 24h.</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {msgStats.map((s) => (
                <div key={s.channel} className="rounded-lg border border-border/50 p-4">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{s.channel}</div>
                  <div className="text-2xl font-bold tabular-nums mt-1">{s.sent}</div>
                  <div className="text-[11px] text-muted-foreground mt-1">
                    sent · {s.failed > 0 && <span className="text-rose-400">{s.failed} failed</span>}
                    {s.failed === 0 && <span className="text-emerald-400">0 failed</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="p-4 bg-muted/30 border-dashed">
        <div className="flex items-start gap-2 text-sm">
          <AlertTriangle className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
          <div>
            <div className="font-medium">Engine is live · 3 cron jobs running forever</div>
            <div className="text-muted-foreground text-[11px] mt-1">
              Stall sweep every 15min · Nudge sweep hourly · Full recompute nightly 03:00 CT · Auto-dispatch fires on every queue insert
            </div>
          </div>
          <Link to="/admin/next-step/stuck" className="ml-auto text-sm hover:underline text-info inline-flex items-center gap-1 shrink-0">
            Stuck pool <ArrowRight className="h-3 w-3" />
          </Link>
          <Link to="/dashboard/team/next-step" className="text-sm hover:underline text-info inline-flex items-center gap-1 shrink-0">
            Manager board <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </Card>
    </div>
  );
}

function KpiTile({ label, value, tone }: { label: string; value: number; tone: "blue" | "rose" | "amber" | "emerald" | "neutral" }) {
  const toneClass: Record<typeof tone, string> = {
    blue: "border-info/30 text-info",
    rose: "border-rose-500/30 text-rose-300",
    amber: "border-amber-500/30 text-amber-300",
    emerald: "border-emerald-500/30 text-emerald-300",
    neutral: "border-border text-foreground",
  } as const;
  return (
    <div className={cn("rounded-lg border bg-card p-3", toneClass[tone])}>
      <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <div className="text-2xl font-bold tabular-nums leading-none mt-1.5">{value.toLocaleString()}</div>
    </div>
  );
}
