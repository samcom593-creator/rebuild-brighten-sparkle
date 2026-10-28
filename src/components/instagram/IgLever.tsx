// Zone 2: the only prose on the board. One server-computed sentence naming the worst leak and one
// button that lands on named people. The 'locked in' gap line is never hidden when it is nonzero.
import { Button } from "@/components/ui/button";
import { NUMBERS } from "./igCopy";
import type { IgLever as IgLeverData } from "./igTypes";

export interface IgLeverProps {
  lever: IgLeverData;
  lockedInGap: number;
  onOpen: () => void;
}

export function IgLever({ lever, lockedInGap, onOpen }: IgLeverProps) {
  return (
    <section aria-label="the lever" className="border-t border-border pt-4">
      <p className="text-sm text-foreground">{lever.sentence}</p>
      {lever.button_label && lever.people.length > 0 && (
        <Button variant="outline" className="mt-3 h-11 w-full sm:h-9 sm:w-auto" onClick={onOpen}>
          {lever.button_label}
        </Button>
      )}
      {lockedInGap > 0 && lever.key !== "locked_in_gap" && (
        <p className="mt-2 text-xs text-muted-foreground">{NUMBERS.lockedInGap(lockedInGap)}</p>
      )}
    </section>
  );
}
