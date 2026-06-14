// FunnelStageCard — shared phone-first funnel-stage card used by
// RecruitingTracker.tsx (3-stage application→link→completed) and
// RecruitingFunnels.tsx (4-stage new→contacted→licensed→first-deal).
//
// Design contract (judge Proposal B, 2026-06-15):
//   - One huge tabular-nums count (text-5xl font-black) + WoW delta with
//     ▲ emerald / ▼ rose / · muted glyph next to it.
//   - text-xs muted subline at the bottom (e.g. "30d total: 489" or
//     "this week: 12").
//   - Null-safe: missing count renders "—", missing delta renders
//     "— new this week". Never "Unknown", never bare "0" for missing data
//     (Sam's 2026-06-10 dashboard rule).
//   - No uppercase tracking-widest micro-labels (kill the desktop typography).

import { cn } from "@/lib/utils";

interface FunnelStageCardProps {
  stageNumber: number;
  stageLabel: string;
  count: number | null;
  delta: number | null;
  /** Bottom subline (e.g. "30d total: 489" or "this week: 12"). */
  subline: string;
  /** Optional inline note rendered under the delta (e.g. data-pending). */
  note?: string;
}

export function FunnelStageCard({
  stageNumber,
  stageLabel,
  count,
  delta,
  subline,
  note,
}: FunnelStageCardProps) {
  const deltaClass = cn(
    "text-sm font-semibold tabular-nums",
    delta != null && delta > 0 && "text-emerald-400",
    delta != null && delta < 0 && "text-rose-400",
    (delta == null || delta === 0) && "text-muted-foreground",
  );

  const deltaContent =
    delta == null
      ? "— new this week"
      : delta > 0
        ? `▲ ${delta}`
        : delta < 0
          ? `▼ ${Math.abs(delta)}`
          : `· 0`;

  return (
    <div className="rounded-3xl bg-card/40 border border-border/40 px-6 py-7">
      <div className="text-sm text-muted-foreground mb-3">
        {stageNumber}. {stageLabel}
      </div>
      <div className="flex items-baseline gap-4 flex-wrap">
        <div className="text-5xl font-black tabular-nums leading-none">
          {count == null ? "—" : count.toLocaleString()}
        </div>
        <div className={deltaClass}>{deltaContent}</div>
      </div>
      <div className="flex items-center gap-2 mt-2">
        <div className="text-xs text-muted-foreground">this week</div>
        <div className="text-xs text-muted-foreground/60">·</div>
        <div className="text-xs text-muted-foreground">vs last week</div>
      </div>
      <div className="text-xs text-muted-foreground/70 mt-3">{subline}</div>
      {note ? (
        <div className="text-xs text-muted-foreground mt-2">{note}</div>
      ) : null}
    </div>
  );
}
