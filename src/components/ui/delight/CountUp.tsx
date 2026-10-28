import { cn } from "@/lib/utils";

/** Live operating numbers update immediately, including during keyboard filtering.
 * Interpolating counts made the number temporarily disagree with the list it opens.
 * Keep the existing API and tabular figures; unknown and non-finite values stay dashes.
 */
export function CountUp({ value, className, format = (n: number) => n.toLocaleString() }: {
  value: number | null;
  className?: string;
  format?: (n: number) => string;
}) {
  return (
    <span className={cn("inline-block tabular-nums", className)}>
      {value === null || !Number.isFinite(value) ? "—" : format(value)}
    </span>
  );
}
