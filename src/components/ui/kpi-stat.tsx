import type { LucideIcon } from "lucide-react";
import { ToneBubble } from "@/components/ui/delight/ToneBubble";
import { CountUp } from "@/components/ui/delight/CountUp";
import { TONE_CLASS, type Tone } from "@/lib/tones";
import { cn } from "@/lib/utils";

/**
 * Present a confirmed metric; the owning query supplies loading and stale states.
 *
 * 2026-10-28 colour layer: the icon sits in a tone bubble, the label is 13px sentence case
 * instead of 11px capitals, and a numeric value counts up when it changes. `accent` keeps its
 * meaning (the headline number, in gold); `tone` colours the bubble and defaults to gold.
 */
export function KPIStat({
  icon: Icon,
  label,
  value,
  detail,
  accent,
  tone = "gold",
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  detail: string;
  accent?: boolean;
  tone?: Tone;
}) {
  const numeric = /^-?\d[\d,]*$/.test(value.trim()) ? Number(value.replace(/,/g, "")) : null;
  const valueClass = cn("mt-2 block truncate text-3xl font-bold tabular-nums", accent ? TONE_CLASS[tone].text : "text-foreground");
  return (
    <div className="min-w-0 border-b border-border p-4 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
      <p className="flex items-center gap-2 text-[13px] font-semibold text-muted-foreground">
        <ToneBubble tone={tone} size="sm"><Icon /></ToneBubble>
        {label}
      </p>
      {numeric !== null && Number.isFinite(numeric) ? (
        <CountUp value={numeric} className={valueClass} />
      ) : (
        <p className={valueClass}>{value}</p>
      )}
      <p className="mt-1 text-[13px] text-muted-foreground">{detail}</p>
    </div>
  );
}
