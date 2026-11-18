import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { QueryState, describeQuery } from "@/components/ui/query-state";
import { AlertTriangle, ArrowRight, Compass, TrendingDown } from "lucide-react";
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
  // MP-WIB-ADMIN-RENDER-HEALTH (2026-11-18): both feeds throw on error and the
  // UI surfaces that error, so a dead view reads as "could not load" with a
  // Retry — never as a healthy, empty pipeline. Until this wave both queries
  // defaulted `data = []` and took no isError, so a failed
  // v_next_step_funnel_health rendered In funnel: 0 / Stalled: 0 and dropped the
  // Biggest-leak card: a clean board at the exact moment 915 recruits were stuck
  // and the feed had just died. Same fake-success class as the landing counter,
  // the hero ticker, and the CFO snapshot.
  const funnelQuery = useQuery<FunnelRow[]>({
    queryKey: ["next-step-funnel-health"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_next_step_funnel_health")
        .select("*")
        .order("order_index", { ascending: true });
      if (error) throw error;
      if (!Array.isArray(data)) throw new Error("The funnel-health read returned no result set.");
      return data as FunnelRow[];
    },
    staleTime: 60_000,
    refetchInterval: 300_000,
  });
  const funnel = funnelQuery.data ?? [];

  const msgStatsQuery = useQuery<MessageStat[]>({
    queryKey: ["next-step-message-stats"],
    queryFn: async () => {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const rpc = await supabase.rpc("next_step_message_stats_24h" as any, { since_ts: since });
      if (!rpc.error && rpc.data) return rpc.data as MessageStat[];
      // Fallback: compute client-side when the RPC is absent. A failed FALLBACK
      // read is an error, never a silent "0 messages" (MP-273 error-discard): a
      // dead next_step_messages read must not read as a quiet outbound day. The
      // RPC's own absence/error is tolerated — that is the reason to fall back —
      // but the fallback query's error is thrown so the card goes red, not green.
      const { data: rows, error: fbError } = await supabase
        .from("next_step_messages")
        .select("channel, sent_at, failed_at")
        .gte("created_at", since)
        .limit(2000);
      if (fbError) throw fbError;
      if (!Array.isArray(rows)) throw new Error("The outbound-messages read returned no result set.");
      const map: Record<string, MessageStat> = {};
      for (const r of rows) {
        const ch = (r as any).channel ?? "unknown";
        if (!map[ch]) map[ch] = { channel: ch, sent: 0, failed: 0 };
        if ((r as any).sent_at) map[ch].sent++;
        if ((r as any).failed_at) map[ch].failed++;
      }
      return Object.values(map).sort((a, b) => b.sent - a.sent);
    },
    staleTime: 60_000,
    refetchInterval: 300_000,
  });
  const msgStats = msgStatsQuery.data ?? [];

  // A tile value is null until the read it comes from SUCCEEDS, so a dead feed
  // shows "—", never a 0 that reads as a true, quiet count. A successful read of
  // an empty stage set is a real 0 and is shown as 0.
  const totals = useMemo(() => {
    const inFunnel = funnel.filter((r) => (r.order_index ?? 0) > 0 && (r.order_index ?? 0) <= 18);
    return {
      total_people: funnelQuery.isSuccess ? inFunnel.reduce((a, r) => a + r.in_stage, 0) : null,
      stalled: funnelQuery.isSuccess ? inFunnel.reduce((a, r) => a + r.stalled, 0) : null,
      active_stages: funnelQuery.isSuccess ? inFunnel.length : null,
      msg_sent_24h: msgStatsQuery.isSuccess ? msgStats.reduce((a, r) => a + r.sent, 0) : null,
      msg_failed_24h: msgStatsQuery.isSuccess ? msgStats.reduce((a, r) => a + r.failed, 0) : null,
    };
  }, [funnel, msgStats, funnelQuery.isSuccess, msgStatsQuery.isSuccess]);

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
        <div className="flex items-center gap-2 text-[12px] uppercase tracking-[0.18em] text-muted-foreground mb-1">
          <Compass className="h-3.5 w-3.5" /> Pipeline · Funnel Health
        </div>
        <h1 className="text-3xl font-bold">Next-Step Funnel Health</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Who sits in each stage right now, and how long. These are today's populations, not cohorts, so the
          last column compares two of them and is not a conversion rate. For conversion, month by month, use the{" "}
          <Link to="/admin/recruit-funnel" className="underline">recruit funnel</Link>.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <KpiTile label="In funnel" value={totals.total_people} tone="blue" />
        <KpiTile label="Stalled" value={totals.stalled} tone={totals.stalled == null ? "neutral" : totals.stalled > 100 ? "rose" : "amber"} />
        <KpiTile label="Active stages" value={totals.active_stages} tone="neutral" />
        <KpiTile label="Msgs sent 24h" value={totals.msg_sent_24h} tone="emerald" />
        <KpiTile label="Msgs failed 24h" value={totals.msg_failed_24h} tone={totals.msg_failed_24h == null ? "neutral" : totals.msg_failed_24h > 5 ? "rose" : "amber"} />
      </div>

      <QueryState
        {...describeQuery(funnelQuery)}
        label="funnel health"
        onRetry={() => void funnelQuery.refetch()}
        asOf={funnelQuery.dataUpdatedAt}
        title="No funnel stages yet"
        body="No pipeline stages are configured, so there is nothing to show here."
      >
        <div className="space-y-6">
          {biggestLeak && (
            <Card className="border-rose-500/40 bg-rose-500/5">
              <CardContent className="p-5">
                <div className="flex items-start gap-3">
                  <div className="rounded-md bg-rose-500/15 p-3 border border-rose-500/30 shrink-0">
                    <TrendingDown className="h-5 w-5 text-rose-300" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-rose-400/80">Biggest concentrated leak</div>
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
              <CardTitle className="text-base">Stage by stage, right now</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border/50">
                      <th className="text-left py-2 px-2">#</th>
                      <th className="text-left py-2 px-2">Stage</th>
                      <th className="text-right py-2 px-2">People</th>
                      <th className="text-right py-2 px-2">Stalled</th>
                      <th className="text-right py-2 px-2">Median (d)</th>
                      <th className="text-right py-2 px-2">→ Next</th>
                      <th className="text-right py-2 px-2" title="Next stage's population divided by this one's, today. Not a conversion rate.">Next ÷ this</th>
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
                              <Badge variant="destructive" className="text-[11px]">
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
            </CardContent>
          </Card>
        </div>
      </QueryState>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Outbound messages (last 24h)</CardTitle>
        </CardHeader>
        <CardContent>
          <QueryState
            {...describeQuery(msgStatsQuery)}
            label="outbound messages"
            onRetry={() => void msgStatsQuery.refetch()}
            asOf={msgStatsQuery.dataUpdatedAt}
            title="No messages dispatched in the last 24h."
            body="Nothing has gone out in the last 24 hours."
          >
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {msgStats.map((s) => (
                <div key={s.channel} className="rounded-lg border border-border/50 p-4">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{s.channel}</div>
                  <div className="text-2xl font-bold tabular-nums mt-1">{s.sent}</div>
                  <div className="text-[12px] text-muted-foreground mt-1">
                    sent · {s.failed > 0 && <span className="text-rose-400">{s.failed} failed</span>}
                    {s.failed === 0 && <span className="text-emerald-400">0 failed</span>}
                  </div>
                </div>
              ))}
            </div>
          </QueryState>
        </CardContent>
      </Card>

      <Card className="p-4 bg-muted/30 border-dashed">
        <div className="flex items-start gap-2 text-sm">
          <AlertTriangle className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
          <div>
            <div className="font-medium">Engine is live · 3 cron jobs running forever</div>
            <div className="text-muted-foreground text-[12px] mt-1">
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

function KpiTile({ label, value, tone }: { label: string; value: number | null; tone: "blue" | "rose" | "amber" | "emerald" | "neutral" }) {
  const toneClass: Record<typeof tone, string> = {
    blue: "border-info/30 text-info",
    rose: "border-rose-500/30 text-rose-300",
    amber: "border-amber-500/30 text-amber-300",
    emerald: "border-emerald-500/30 text-emerald-300",
    neutral: "border-border text-foreground",
  } as const;
  return (
    <div className={cn("rounded-lg border bg-card p-3", toneClass[tone])}>
      <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <div className="text-2xl font-bold tabular-nums leading-none mt-1.5">{value == null ? "—" : value.toLocaleString()}</div>
    </div>
  );
}
