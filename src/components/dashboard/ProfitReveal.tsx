import { useEffect, useState } from "react";
import { Eye, EyeOff, TrendingUp, RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

/**
 * ProfitReveal — admin/manager dashboard widget showing money in from the 4
 * paid offers (gross + net of ReadyMode cost). Blurred by default, click to
 * reveal, click again to blur. Persists reveal state in sessionStorage so
 * navigating around the dashboard doesn't keep flicking it.
 *
 * ReadyMode cost: $250/month/active-leads-subscriber. Configurable via
 * VITE_READYMODE_COST_CENTS so Sam can tune without a code change.
 */
const READYMODE_COST_PER_MONTH_CENTS = Number(
  (import.meta as any).env?.VITE_READYMODE_COST_CENTS ?? 25000,
);

type Window = "30d" | "all";

interface Stats {
  grossCents: number;
  countByMode: Record<string, number>; // weekly|monthly
  activeLeadsSubs: number;
  netCents: number;
  thisMonthCents: number;
}

const cents = (n: number) => `$${(n / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

export function ProfitReveal() {
  const [revealed, setRevealed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.sessionStorage.getItem("apex_profit_revealed") === "1";
  });
  const [window7, setWindow] = useState<Window>("30d");
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const sinceDays = window7 === "30d" ? 30 : 365 * 5;
      const since = new Date(Date.now() - sinceDays * 86400_000).toISOString();
      const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();

      const [{ data: rows = [] }, { data: monthRows = [] }] = await Promise.all([
        supabase
          .from("offer_purchases" as any)
          .select("sku, mode, amount_cents, status")
          .gte("created_at", since),
        supabase
          .from("offer_purchases" as any)
          .select("amount_cents, status")
          .gte("created_at", monthStart),
      ]);

      const paid = (rows as any[]).filter(r => r.status === "paid");
      const grossCents = paid.reduce((a, r) => a + (r.amount_cents || 0), 0);
      const countByMode: Record<string, number> = {};
      paid.forEach(r => { countByMode[r.mode] = (countByMode[r.mode] || 0) + 1; });

      const activeLeadsSubs = paid.filter(r => r.sku === "gold" || r.sku === "platinum").length;
      const monthCost = activeLeadsSubs * READYMODE_COST_PER_MONTH_CENTS;
      const netCents = grossCents - monthCost;

      const thisMonthCents = (monthRows as any[])
        .filter(r => r.status === "paid")
        .reduce((a, r) => a + (r.amount_cents || 0), 0);

      setStats({ grossCents, countByMode, activeLeadsSubs, netCents, thisMonthCents });
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); /* refresh */ }, [window7]);

  // Realtime: any new paid purchase nudges the numbers up.
  useEffect(() => {
    const channel = supabase
      .channel("profit-reveal")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "offer_purchases" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const toggle = () => {
    const next = !revealed;
    setRevealed(next);
    if (typeof window !== "undefined") window.sessionStorage.setItem("apex_profit_revealed", next ? "1" : "0");
  };

  const blurClass = revealed ? "" : "blur-md select-none pointer-events-none";

  return (
    <Card className="p-5 bg-gradient-to-br from-emerald-500/5 via-background to-background border-emerald-500/20">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-lg bg-emerald-500/15">
            <TrendingUp className="h-4 w-4 text-emerald-400" />
          </div>
          <div>
            <div className="text-sm font-semibold">APEX Offer Revenue</div>
            <div className="text-[11px] text-muted-foreground">
              {window7 === "30d" ? "Last 30 days" : "All-time"} · ReadyMode-net
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setWindow(window7 === "30d" ? "all" : "30d")} title="Toggle window">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={toggle} title={revealed ? "Blur" : "Reveal"}>
            {revealed ? <EyeOff className="h-4 w-4 text-emerald-400" /> : <Eye className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      <button
        onClick={toggle}
        className={cn("w-full text-left transition-all duration-300", revealed ? "" : "cursor-pointer")}
        title={revealed ? "Click to blur" : "Click to reveal"}
      >
        <div className={cn("transition-all duration-300", blurClass)}>
          {loading ? (
            <div className="text-3xl font-bold tabular-nums">—</div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Gross</div>
                  <div className="text-2xl font-bold tabular-nums text-emerald-400">{cents(stats?.grossCents ?? 0)}</div>
                </div>
                <div>
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Net (− ReadyMode)</div>
                  <div className="text-2xl font-bold tabular-nums text-emerald-300">{cents(stats?.netCents ?? 0)}</div>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className="text-[10px]">
                  This month: <span className="ml-1 font-bold tabular-nums">{cents(stats?.thisMonthCents ?? 0)}</span>
                </Badge>
                <Badge variant="outline" className="text-[10px]">
                  Active leads subs: <span className="ml-1 font-bold tabular-nums">{stats?.activeLeadsSubs ?? 0}</span>
                </Badge>
                <Badge variant="outline" className="text-[10px]">
                  Weekly: <span className="ml-1 font-bold tabular-nums">{stats?.countByMode?.["subscription"] ?? 0}</span> subs
                </Badge>
              </div>
            </>
          )}
        </div>
      </button>

      <div className="text-[10px] text-muted-foreground/70 mt-3">
        Tap card to {revealed ? "blur" : "reveal"} · auto-updates on every new sale
      </div>
    </Card>
  );
}
