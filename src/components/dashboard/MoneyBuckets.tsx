import { useEffect, useState } from "react";
import { Car, Trophy, Plane, PiggyBank, Eye, EyeOff, Sparkles } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

/**
 * MoneyBuckets — admin-only widget that shows progress toward Sam's
 * personal money goals (car payoff, Lambo Urus down + buy, travel,
 * APEX growth reinvest), funded out of net APEX offer revenue.
 *
 * Allocation strategy comes from sam_money_plan.md: 45% car payoff,
 * 30% Lambo down, 15% travel, 10% reinvest. Sam can override via
 * VITE_BUCKET_SPLIT (JSON string) without a code change.
 *
 * Numbers are blurred by default (matches ProfitReveal — sensitive on
 * a shared screen). Click any bucket to reveal/blur all of them.
 */
const TARGETS_CENTS = {
  car_payoff: 25_000_00,
  lambo_down: 20_000_00,
  lambo_buy: 25_000_00,
  travel: 10_000_00,
  reinvest: 0, // unbounded — counts up forever
};

const SPLIT_DEFAULT = { car_payoff: 45, lambo_down: 30, travel: 15, reinvest: 10 };
let SPLIT: typeof SPLIT_DEFAULT = SPLIT_DEFAULT;
try {
  const raw = (import.meta as any).env?.VITE_BUCKET_SPLIT;
  if (raw) SPLIT = { ...SPLIT_DEFAULT, ...JSON.parse(raw) };
} catch {}

const READYMODE_COST_CENTS = Number((import.meta as any).env?.VITE_READYMODE_COST_CENTS ?? 25_000);

const cents = (n: number) => `$${Math.round(n / 100).toLocaleString()}`;

interface Bucket {
  key: keyof typeof TARGETS_CENTS;
  label: string;
  icon: typeof Car;
  accent: string;
  target: number;
  saved: number;
}

export function MoneyBuckets() {
  const [revealed, setRevealed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.sessionStorage.getItem("apex_money_revealed") === "1";
  });
  const [grossCents, setGrossCents] = useState(0);
  const [activeLeadsSubs, setActiveLeadsSubs] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const since = new Date("2026-01-01T00:00:00Z").toISOString();
    const { data: rows = [] } = await supabase
      .from("offer_purchases" as any)
      .select("sku, amount_cents, status, purchaser_email")
      .gte("created_at", since);
    const paid = (rows as any[]).filter(r => r.status === "paid");
    const gross = paid.reduce((a, r) => a + (r.amount_cents || 0), 0);
    setGrossCents(gross);
    const active = new Set(
      paid.filter(r => r.sku === "gold" || r.sku === "platinum").map(r => r.purchaser_email).filter(Boolean),
    );
    setActiveLeadsSubs(active.size);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("money-buckets")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "offer_purchases" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  // Net = gross − ReadyMode monthly cost × active subs (since Jan 1)
  // Approximate: assume average sub age = 1 month; this is good-enough Phase 1.
  const netCents = Math.max(0, grossCents - activeLeadsSubs * READYMODE_COST_CENTS);

  const buckets: Bucket[] = [
    { key: "car_payoff", label: "Pay off car", icon: Car,    accent: "text-emerald-400", target: TARGETS_CENTS.car_payoff,  saved: Math.round(netCents * (SPLIT.car_payoff / 100)) },
    { key: "lambo_down", label: "Lambo Urus — down", icon: Trophy, accent: "text-yellow-300", target: TARGETS_CENTS.lambo_down, saved: Math.round(netCents * (SPLIT.lambo_down / 100)) },
    { key: "lambo_buy",  label: "Lambo Urus — buy", icon: Trophy, accent: "text-yellow-300/70", target: TARGETS_CENTS.lambo_buy,  saved: 0 },
    { key: "travel",     label: "Travel fund", icon: Plane,  accent: "text-sky-400", target: TARGETS_CENTS.travel, saved: Math.round(netCents * (SPLIT.travel / 100)) },
    { key: "reinvest",   label: "APEX reinvest", icon: PiggyBank, accent: "text-fuchsia-400", target: 0, saved: Math.round(netCents * (SPLIT.reinvest / 100)) },
  ];

  const toggle = () => {
    const n = !revealed; setRevealed(n);
    if (typeof window !== "undefined") window.sessionStorage.setItem("apex_money_revealed", n ? "1" : "0");
  };
  const blurClass = revealed ? "" : "blur-md select-none pointer-events-none";

  return (
    <Card className="p-5 bg-gradient-to-br from-violet-500/5 via-background to-background border-violet-500/20">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-lg bg-violet-500/15">
            <Sparkles className="h-4 w-4 text-violet-300" />
          </div>
          <div>
            <div className="text-sm font-semibold">Money Buckets</div>
            <div className="text-[11px] text-muted-foreground">
              Net APEX revenue split by goal · {SPLIT.car_payoff}/{SPLIT.lambo_down}/{SPLIT.travel}/{SPLIT.reinvest}
            </div>
          </div>
        </div>
        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={toggle}>
          {revealed ? <EyeOff className="h-4 w-4 text-violet-300" /> : <Eye className="h-4 w-4" />}
        </Button>
      </div>

      <button onClick={toggle} className="w-full text-left">
        <div className={cn("space-y-3 transition-all duration-300", blurClass)}>
          {loading ? (
            <div className="text-3xl font-bold tabular-nums">—</div>
          ) : (
            <>
              <div className="flex items-baseline justify-between mb-2">
                <div>
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Net YTD (after ReadyMode)</div>
                  <div className="text-2xl font-bold tabular-nums text-violet-300">{cents(netCents)}</div>
                </div>
                <Badge variant="outline" className="text-[10px]">
                  Gross: <span className="ml-1 font-bold tabular-nums">{cents(grossCents)}</span>
                </Badge>
              </div>

              {buckets.map((b) => {
                const pct = b.target > 0 ? Math.min(100, Math.round((b.saved / b.target) * 100)) : 0;
                return (
                  <div key={b.key} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <b.icon className={cn("h-3.5 w-3.5", b.accent)} />
                        <span>{b.label}</span>
                      </div>
                      <span className="tabular-nums text-muted-foreground">
                        <span className={cn("font-semibold", b.accent)}>{cents(b.saved)}</span>
                        {b.target > 0 && <> / {cents(b.target)}</>}
                      </span>
                    </div>
                    {b.target > 0 ? <Progress value={pct} className="h-1.5" /> : null}
                  </div>
                );
              })}
            </>
          )}
        </div>
      </button>

      <div className="text-[10px] text-muted-foreground/70 mt-4">
        Tap card to {revealed ? "blur" : "reveal"} · Phase 2: live Mercury allocation
      </div>
    </Card>
  );
}
