import { useAnimatedCounter } from "@/hooks/useAnimatedCounter";
import { cn } from "@/lib/utils";

interface AnimatedCounterProps {
  value: number;
  prefix?: string;
  suffix?: string;
  duration?: number;
  className?: string;
  formatOptions?: Intl.NumberFormatOptions;
}

export function AnimatedCounter({
  value,
  prefix = "",
  suffix = "",
  duration = 2000,
  className,
  formatOptions,
}: AnimatedCounterProps) {
  const { count, ref } = useAnimatedCounter(value, { duration });

  const formattedCount = formatOptions
    ? new Intl.NumberFormat("en-US", formatOptions).format(count)
    : count.toLocaleString();

  return (
    <span ref={ref as React.RefObject<HTMLSpanElement>} className={cn("tabular-nums", className)}>
      {prefix}
      {formattedCount}
      {suffix}
    </span>
  );
}