import { forwardRef } from "react";
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

// ForwardRef to prevent React warning when used with motion components
export const AnimatedCounter = forwardRef<HTMLSpanElement, AnimatedCounterProps>(
  (
    {
      value,
      prefix = "",
      suffix = "",
      duration = 2000,
      className,
      formatOptions,
    },
    forwardedRef
  ) => {
    const { count, ref: internalRef } = useAnimatedCounter(value, { duration });

    // Combine internal ref with forwarded ref
    const combinedRef = (node: HTMLSpanElement | null) => {
      // Set internal ref
      (internalRef as React.MutableRefObject<HTMLSpanElement | null>).current = node;
      // Set forwarded ref
      if (typeof forwardedRef === "function") {
        forwardedRef(node);
      } else if (forwardedRef) {
        forwardedRef.current = node;
      }
    };

    const formattedCount = formatOptions
      ? new Intl.NumberFormat("en-US", formatOptions).format(count)
      : count.toLocaleString();

    return (
      <span ref={combinedRef} className={cn("tabular-nums", className)}>
        {prefix}
        {formattedCount}
        {suffix}
      </span>
    );
  }
);

AnimatedCounter.displayName = "AnimatedCounter";