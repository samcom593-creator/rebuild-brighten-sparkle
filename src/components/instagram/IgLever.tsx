// The biggest leak (OVERHAUL-instagram, 2026-10-28): the one server-computed sentence naming where the
// month leaks most, with one button that lands on the named people. The "locked in" gap line is
// never hidden while it is nonzero. When nothing leaks the card says so in the good tone.
import { CheckCircle2, TrendingDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ToneBubble } from "@/components/ui/delight/ToneBubble";
import { NUMBERS, SECTION } from "./igCopy";
import { sentenceCase } from "./igFormat";
import type { IgLever as IgLeverData } from "./igTypes";

export interface IgLeverProps {
  lever: IgLeverData;
  lockedInGap: number;
  onOpen: () => void;
}

export function IgLever({ lever, lockedInGap, onOpen }: IgLeverProps) {
  const calm = lever.key === "none";
  const canOpen = !!lever.button_label && lever.people.length > 0;
  return (
    <section aria-labelledby="ig-lever-heading" className="rounded-xl border border-border bg-card p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <ToneBubble tone={calm ? "good" : "warm"} size="md">{calm ? <CheckCircle2 /> : <TrendingDown />}</ToneBubble>
        <div className="min-w-0 flex-1">
          <h2 id="ig-lever-heading" className="text-base font-semibold text-foreground">{SECTION.leak}</h2>
          <p className="mt-1 text-[15px] leading-[22px] text-foreground">{sentenceCase(lever.sentence)}</p>
          {lockedInGap > 0 && lever.key !== "locked_in_gap" ? (
            <p className="mt-1 text-sm text-muted-foreground">{NUMBERS.lockedInGap(lockedInGap)}</p>
          ) : null}
          {canOpen ? (
            <Button variant="outline" className="mt-3 h-11 w-full sm:h-10 sm:w-auto" onClick={onOpen}>
              {sentenceCase(lever.button_label)}
            </Button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
