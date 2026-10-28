// Zone 3: six small numbers, each a to-do. Fixed 30 days; no toggle; a zero denominator prints '–'.
import { Button } from "@/components/ui/button";
import { NUMBERS, SECTION } from "./igCopy";
import { fmtInt, pctOf } from "./igFormat";
import type { IgStage, IgStageKey } from "./igTypes";

export const STRIP_KEYS: IgStageKey[] = ["in", "business", "number", "booked", "applied", "hired"];

export interface IgFunnelStripProps {
  stages: IgStage[];
  onOpenStage: (stage: IgStage) => void;
}

export function stepRate(stage: IgStage, stages: IgStage[]): string | null {
  if (!stage.prev_key) return null;
  const prev = stages.find((s) => s.key === stage.prev_key);
  return pctOf(stage.count, prev?.count ?? 0);
}

export function IgFunnelStrip({ stages, onOpenStage }: IgFunnelStripProps) {
  const tiles = STRIP_KEYS.map((k) => stages.find((s) => s.key === k)).filter((s): s is IgStage => !!s);
  return (
    <section aria-labelledby="ig-funnel-heading" className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="ig-funnel-heading" className="text-sm font-semibold tracking-tight">{SECTION.funnel}</h2>
        <span className="text-xs text-muted-foreground">{SECTION.tapANumber}</span>
      </div>
      <div className="grid grid-cols-3 gap-1 sm:grid-cols-6">
        {tiles.map((stage) => {
          const rate = stepRate(stage, stages);
          return (
            <Button
              key={stage.key}
              variant="ghost"
              className="flex h-auto min-h-[44px] flex-col items-start gap-0 px-2 py-2 text-left"
              aria-label={`${stage.label} ${stage.count}`}
              onClick={() => onOpenStage(stage)}
            >
              <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{stage.label}</span>
              <span className="text-base font-semibold tabular-nums">{fmtInt(stage.count)}</span>
              <span className="text-[11px] text-muted-foreground">{rate ? NUMBERS.ofPrev(rate) : stage.caption}</span>
              {rate ? <span className="text-[11px] text-muted-foreground">{stage.caption}</span> : null}
            </Button>
          );
        })}
      </div>
    </section>
  );
}
