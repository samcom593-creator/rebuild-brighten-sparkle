import { useRef, type KeyboardEvent } from "react";

import { TONE_CLASS, type Tone } from "@/lib/tones";
import { cn } from "@/lib/utils";

/** A picked option: the tone's 8% tint (a selected tile) and its 35% hairline. Literal so Tailwind sees every class. */
const PICKED: Record<Tone, string> = {
  good: "border-tone-good/35 bg-tone-good/8",
  warm: "border-tone-warm/35 bg-tone-warm/8",
  hot: "border-tone-hot/35 bg-tone-hot/8",
  cool: "border-tone-cool/35 bg-tone-cool/8",
  royal: "border-tone-royal/35 bg-tone-royal/8",
  gold: "border-tone-gold/35 bg-tone-gold/8",
  slate: "border-tone-slate/35 bg-tone-slate/8",
};

/** The radio ring of a picked option, in its tone. */
const RING: Record<Tone, string> = {
  good: "border-tone-good",
  warm: "border-tone-warm",
  hot: "border-tone-hot",
  cool: "border-tone-cool",
  royal: "border-tone-royal",
  gold: "border-tone-gold",
  slate: "border-tone-slate",
};

export interface ChoiceOption<V extends string> {
  value: V;
  label: string;
  /** The tone the option wears once picked (src/lib/tones.ts). The label always says the state. */
  tone?: Tone;
}

/**
 * One either-or question as big buttons: a radio group (OVERHAUL-1, 2026-10-29).
 *
 * Built for "Quick link or With details", "Licensed or Not licensed yet" and "Permanent or
 * Temporary". A picked option shows a filled ring and its tone's 8% tint with a 1px hairline,
 * so it never relies on colour alone; nothing is picked until someone picks (value null), which
 * is how License stays a required choice with no default. Arrow keys move the choice the way
 * native radios do, Tab enters on the picked option (or the first) and leaves the group.
 */
export function ChoiceGroup<V extends string>({
  label,
  value,
  options,
  onChange,
  invalid = false,
  describedBy,
  stackOnPhone = false,
  className,
}: {
  /** The accessible name of the group (the question). */
  label: string;
  value: V | null;
  options: ReadonlyArray<ChoiceOption<V>>;
  onChange: (value: V) => void;
  invalid?: boolean;
  describedBy?: string;
  /** One option per row under 640px, for labels too long to sit two across ("Not licensed yet"). */
  stackOnPhone?: boolean;
  className?: string;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const checkedIndex = options.findIndex((o) => o.value === value);
  const focusIndex = checkedIndex >= 0 ? checkedIndex : 0;

  const move = (from: number, step: number) => {
    const next = (from + step + options.length) % options.length;
    onChange(options[next].value);
    refs.current[next]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      move(index, 1);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      move(index, -1);
    }
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-required="true"
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      className={cn("grid gap-2", stackOnPhone ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-2", className)}
    >
      {options.map((option, index) => {
        const checked = option.value === value;
        const toneName = option.tone ?? "gold";
        return (
          <button
            key={option.value}
            ref={(el) => { refs.current[index] = el; }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={index === focusIndex ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(e) => onKeyDown(e, index)}
            className={cn(
              "flex min-h-12 w-full select-none items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-base font-medium leading-snug transition-colors focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]",
              checked
                ? cn(PICKED[toneName], "text-foreground")
                : invalid
                  ? "border-destructive/60 bg-card text-foreground"
                  : "border-border bg-card text-muted-foreground hover:bg-muted/50 hover:text-foreground",
            )}
          >
            {/* The ring is the radio mark; the label beside it carries the meaning. */}
            <span
              aria-hidden="true"
              className={cn(
                "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2",
                checked ? RING[toneName] : "border-muted-foreground/50",
              )}
            >
              {checked && <span className={cn("h-2.5 w-2.5 rounded-full", TONE_CLASS[toneName].dot)} />}
            </span>
            <span className="min-w-0">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
