import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";

interface DeltaCardProps {
  label: string;
  current: number;
  previous: number;
  suffix?: string;
}

function DeltaCard({ label, current, previous, suffix = "" }: DeltaCardProps) {
  const delta = current - previous;
  const pct = previous > 0 ? Math.round((delta / previous) * 100) : current > 0 ? 100 : 0;
  const isUp = delta > 0;
  const isDown = delta < 0;

  return (
    <div className="p-3 rounded-lg border border-border bg-card/50 space-y-1">
      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</p>
      <p className="text-xl font-bold text-foreground">{current.toLocaleString()}{suffix}</p>
      <div className="flex items-center gap-1 text-xs">
        {isUp && <TrendingUp className="h-3 w-3 text-emerald-500" />}
        {isDown && <TrendingDown className="h-3 w-3 text-red-500" />}
        {!isUp && !isDown && <Minus className="h-3 w-3 text-muted-foreground" />}
        <span className={isUp ? "text-emerald-500" : isDown ? "text-red-500" : "text-muted-foreground"}>
          {isUp ? "+" : ""}{delta.toLocaleString()} ({pct}%)
        </span>
        <span className="text-muted-foreground">vs last week</span>
      </div>
    </div>
  );
}

interface GrowthDeltaCardsProps {
  currentWeek: { apps: number; views: number; followers: number; latestCount: number };
  previousWeek: { apps: number; views: number; followers: number; latestCount: number };
}

export function GrowthDeltaCards({ currentWeek, previousWeek }: GrowthDeltaCardsProps) {
  return (
    <GlassCard className="p-4">
      <h3 className="font-semibold mb-3 text-sm">Week-over-Week Comparison</h3>
      <div className="grid grid-cols-2 gap-3">
        <DeltaCard label="Applications" current={currentWeek.apps} previous={previousWeek.apps} />
        <DeltaCard label="IG Views" current={currentWeek.views} previous={previousWeek.views} />
        <DeltaCard label="New Followers" current={currentWeek.followers} previous={previousWeek.followers} />
        <DeltaCard label="Total Followers" current={currentWeek.latestCount} previous={previousWeek.latestCount} />
      </div>
    </GlassCard>
  );
}
