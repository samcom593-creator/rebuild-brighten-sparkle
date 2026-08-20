import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Crown, TrendingUp, Activity, AlertTriangle, Users, ArrowRight, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

/**
 * Sam's primary front-dashboard widget: BUILDERS.
 *
 * Sam-feedback 2026-06-03: "my primary focus is holding on to builders, and
 * people who run teams." Shows everyone Sam directly recruited, classified by
 * builder tier, with onboarding progress + active-producing flag.
 *
 * Reads from v_sam_builders_dashboard (view shipped 2026-06-03).
 */

interface BuilderRow {
  agent_id: string;
  name: string;
  email: string | null;
  hired_date: string;
  license_status: string | null;
  status: string | null;
  onboarding_stage: string | null;
  direct_recruits: number;
  own_ap_mtd: number;
  own_deals_mtd: number;
  downline_ap_mtd: number;
  team_ap_mtd: number;
  days_to_first_deal: number | null;
  last_deal_date: string | null;
  builder_tier: "builder_strong" | "builder_emerging" | "producer" | "producer_light" | "new_hire" | "dormant" | "unknown";
  progress_label: string;
  actively_producing: boolean;
}

const TIER_META: Record<BuilderRow["builder_tier"], { label: string; tone: string; icon: typeof Crown }> = {
  builder_strong: { label: "Strong builder", tone: "bg-yellow-500/15 text-yellow-300 border-yellow-500/40", icon: Crown },
  builder_emerging: { label: "Emerging builder", tone: "bg-amber-500/15 text-amber-200 border-amber-500/40", icon: Sparkles },
  producer: { label: "Producer", tone: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40", icon: TrendingUp },
  producer_light: { label: "Light producer", tone: "bg-emerald-500/10 text-emerald-200 border-emerald-500/30", icon: Activity },
  new_hire: { label: "New hire", tone: "bg-blue-500/15 text-blue-200 border-blue-500/40", icon: Users },
  dormant: { label: "Dormant", tone: "bg-zinc-500/15 text-muted-foreground border-zinc-500/40", icon: AlertTriangle },
  unknown: { label: "—", tone: "bg-zinc-500/10 text-muted-foreground border-zinc-500/30", icon: Users },
};

function fmtUSD(n: number): string {
  if (!n) return "$0";
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${n}`;
}

function daysAgo(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const diff = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (diff <= 0) return "today";
  if (diff === 1) return "1d";
  if (diff < 30) return `${diff}d`;
  if (diff < 365) return `${Math.floor(diff / 30)}mo`;
  return `${Math.floor(diff / 365)}y`;
}

export function BuilderProgressDashboard() {
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["sam-builders-dashboard"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_sam_builders_dashboard" as any)
        .select("*");
      if (error) throw error;
      return (data ?? []) as BuilderRow[];
    },
    refetchInterval: 60_000,
  });

  const summary = useMemo(() => {
    const builders = rows.filter((r) => r.builder_tier === "builder_strong" || r.builder_tier === "builder_emerging");
    const producers = rows.filter((r) => r.builder_tier === "producer" || r.builder_tier === "producer_light");
    const dormant = rows.filter((r) => r.builder_tier === "dormant");
    const newHires = rows.filter((r) => r.builder_tier === "new_hire");
    const activelyProducing = rows.filter((r) => r.actively_producing).length;
    const teamAp = rows.reduce((s, r) => s + (r.team_ap_mtd || 0), 0);
    return {
      total: rows.length,
      builders: builders.length,
      producers: producers.length,
      dormant: dormant.length,
      newHires: newHires.length,
      activelyProducing,
      teamAp,
    };
  }, [rows]);

  // Group rows for display: builders first, then producers, then new hires, then dormant
  const groups = useMemo(() => {
    const byTier = (tier: BuilderRow["builder_tier"]) => rows.filter((r) => r.builder_tier === tier);
    return {
      strong: byTier("builder_strong"),
      emerging: byTier("builder_emerging"),
      producer: byTier("producer"),
      producer_light: byTier("producer_light"),
      new_hire: byTier("new_hire"),
      dormant: byTier("dormant"),
    };
  }, [rows]);

  const focusRows = useMemo(
    () => [...groups.strong, ...groups.emerging, ...groups.producer, ...groups.producer_light, ...groups.new_hire],
    [groups],
  );

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">My builders</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">Loading…</CardContent>
      </Card>
    );
  }

  if (rows.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Crown className="h-4 w-4 text-amber-500" /> My builders
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          No direct recruits yet. Add an agent under your line to start seeing them here.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-yellow-500/30">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Crown className="h-4 w-4 text-amber-500" /> My builders
              <Badge variant="outline" className="ml-2 border-yellow-500/40 text-yellow-300">
                {summary.total} direct
              </Badge>
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Hold the builders. Run the line. {summary.activelyProducing} producing in last 14d • {fmtUSD(summary.teamAp)} team AP MTD.
            </p>
          </div>
          <Button asChild size="sm" variant="ghost" className="text-xs">
            <Link to="/dashboard/recruit">
              Recruit center <ArrowRight className="h-3 w-3 ml-1" />
            </Link>
          </Button>
        </div>

        {/* Top-line counters */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mt-3">
          <Counter label="Builders" value={summary.builders} tone="text-yellow-300" />
          <Counter label="Producers" value={summary.producers} tone="text-emerald-300" />
          <Counter label="Active 14d" value={summary.activelyProducing} tone="text-emerald-300" />
          <Counter label="New hires" value={summary.newHires} tone="text-blue-300" />
          <Counter label="Dormant" value={summary.dormant} tone="text-muted-foreground" />
        </div>
      </CardHeader>

      <CardContent className="space-y-1 pt-0">
        {focusRows.length === 0 && (
          <p className="text-sm text-muted-foreground py-4">
            No active builders or producers yet. {summary.dormant} dormant recruits to re-engage.
          </p>
        )}
        {focusRows.map((r) => (
          <BuilderRowItem key={r.agent_id} row={r} />
        ))}
        {summary.dormant > 0 && (
          <details className="pt-3 mt-2 border-t border-border/40">
            <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground transition">
              Show {summary.dormant} dormant recruits (no deal in 30d)
            </summary>
            <div className="mt-2 space-y-1">
              {groups.dormant.map((r) => (
                <BuilderRowItem key={r.agent_id} row={r} muted />
              ))}
            </div>
          </details>
        )}
      </CardContent>
    </Card>
  );
}

function Counter({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-md border border-border/40 bg-white dark:bg-card/40 px-3 py-2">
      <div className={cn("text-xl font-bold leading-none", tone)}>{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">{label}</div>
    </div>
  );
}

function BuilderRowItem({ row, muted = false }: { row: BuilderRow; muted?: boolean }) {
  const meta = TIER_META[row.builder_tier];
  const Icon = meta.icon;
  return (
    <Link
      to={`/admin/agents`}
      className={cn(
        "flex items-center gap-3 rounded-md border px-3 py-2 hover:bg-white dark:bg-card/60 transition",
        muted ? "border-border/30 opacity-70" : "border-border/40",
      )}
    >
      <div className={cn("h-7 w-7 rounded-md border flex items-center justify-center shrink-0", meta.tone)}>
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <div className="text-sm font-medium truncate">{row.name}</div>
          {row.actively_producing && (
            <span className="inline-flex items-center gap-1 text-[10px] text-emerald-300">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> producing
            </span>
          )}
        </div>
        <div className="text-xs text-muted-foreground flex items-center gap-2">
          <span>{row.progress_label}</span>
          <span>•</span>
          <span>{row.direct_recruits} downline</span>
          <span>•</span>
          <span>hired {daysAgo(row.hired_date)} ago</span>
        </div>
      </div>
      <div className="text-right shrink-0">
        <div className="text-sm font-semibold tabular-nums">{fmtUSD(row.team_ap_mtd)}</div>
        <div className="text-[10px] text-muted-foreground tabular-nums">
          own {fmtUSD(row.own_ap_mtd)} • team {fmtUSD(row.downline_ap_mtd)}
        </div>
      </div>
    </Link>
  );
}
