/**
 * StripeRevenueCard — admin-only snapshot of Stripe lead-purchase revenue,
 * sync cursor status, and matched-vs-unmatched breakdown. Refreshes every 5 min.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import { CreditCard, CheckCircle2, AlertCircle, Clock } from "lucide-react";

type Stats = {
  total: number;
  revenue: number;
  matched: number;
  thisMonth: number;
  monthRevenue: number;
  lastCharge: string | null;
  cursor: { last_fired_at: string | null; last_drained_at: string | null; last_error: string | null; last_synced: number } | null;
};

export function StripeRevenueCard() {
  const { data, isLoading } = useQuery<Stats>({
    queryKey: ["stripe-revenue-card"],
    refetchInterval: 5 * 60 * 1000,
    queryFn: async () => {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

      const [{ data: allRows }, { data: monthRows }, { data: cursor }] = await Promise.all([
        supabase.from("lead_purchases").select("amount_cents, agent_id, charged_at"),
        supabase.from("lead_purchases").select("amount_cents").gte("charged_at", monthStart),
        supabase.from("stripe_sync_cursor").select("last_fired_at,last_drained_at,last_error,last_synced").eq("id", 1).maybeSingle(),
      ]);

      const rows = (allRows ?? []) as Array<{ amount_cents: number; agent_id: string | null; charged_at: string }>;
      const total = rows.length;
      const revenue = rows.reduce((s, r) => s + (r.amount_cents ?? 0), 0) / 100;
      const matched = rows.filter(r => r.agent_id).length;
      const thisMonth = (monthRows ?? []).length;
      const monthRevenue = ((monthRows ?? []) as Array<{ amount_cents: number }>)
        .reduce((s, r) => s + (r.amount_cents ?? 0), 0) / 100;
      const lastCharge = rows.length
        ? rows.map(r => r.charged_at).sort().pop() ?? null
        : null;

      return { total, revenue, matched, thisMonth, monthRevenue, lastCharge, cursor: cursor as Stats["cursor"] };
    },
  });

  const lastSync = data?.cursor?.last_drained_at ?? data?.cursor?.last_fired_at;
  const syncLabel = !lastSync ? "never" : relativeMinutes(lastSync);
  const hasError = !!data?.cursor?.last_error;

  return (
    <GlassCard className="p-4 space-y-3">
      <div className="flex items-center gap-2">
        <CreditCard className="h-4 w-4 text-violet-400" />
        <span className="text-sm font-bold">Stripe Lead Revenue</span>
        <div className="flex-1" />
        {hasError
          ? <Badge variant="outline" className="text-[10px] border-rose-500/30 text-rose-400">
              <AlertCircle className="h-2.5 w-2.5 mr-1" /> sync error
            </Badge>
          : <Badge variant="outline" className="text-[10px] border-emerald-500/30 text-emerald-400">
              <CheckCircle2 className="h-2.5 w-2.5 mr-1" /> {syncLabel}
            </Badge>}
      </div>

      {isLoading || !data ? (
        <div className="text-xs text-muted-foreground py-2">Loading…</div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <Stat label="This Month" value={`$${data.monthRevenue.toLocaleString()}`} sub={`${data.thisMonth} charges`} />
          <Stat label="All-time" value={`$${data.revenue.toLocaleString()}`} sub={`${data.total} charges`} />
          <Stat label="Matched to agent" value={`${data.matched}/${data.total}`} sub={data.total ? `${Math.round(100*data.matched/data.total)}%` : "—"} />
          <Stat label="Last charge" value={data.lastCharge ? relativeMinutes(data.lastCharge) : "—"} sub={data.lastCharge ? new Date(data.lastCharge).toLocaleDateString() : ""} />
        </div>
      )}

      {hasError && (
        <div className="text-[10px] text-rose-400 bg-rose-500/5 rounded p-2 font-mono">
          {data?.cursor?.last_error}
        </div>
      )}

      <div className="flex items-center gap-1 text-[10px] text-muted-foreground pt-1 border-t border-border/30">
        <Clock className="h-3 w-3" />
        Hourly sync · last pulled {syncLabel}
      </div>
    </GlassCard>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-md bg-muted/20 px-3 py-2 border border-border/20">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-sm font-bold tabular-nums">{value}</div>
      <div className="text-[10px] text-muted-foreground">{sub}</div>
    </div>
  );
}

function relativeMinutes(ts: string): string {
  const diff = (Date.now() - new Date(ts).getTime()) / 60000;
  if (diff < 1) return "just now";
  if (diff < 60) return `${Math.floor(diff)}m ago`;
  if (diff < 1440) return `${Math.floor(diff/60)}h ago`;
  return `${Math.floor(diff/1440)}d ago`;
}
