/**
 * Shared closing rate color logic
 * Thresholds:
 * - <30% = Red
 * - <60% = Yellow
 * - >=60% = Green
 */

export function getClosingRateColor(rate: number): {
  textClass: string;
  bgClass: string;
  tone: "red" | "yellow" | "green";
} {
  if (rate < 30) {
    return {
      textClass: "text-destructive",
      bgClass: "bg-destructive/10",
      tone: "red",
    };
  }

  if (rate < 60) {
    return {
      textClass: "text-amber-500",
      bgClass: "bg-amber-500/10",
      tone: "yellow",
    };
  }

  return {
    textClass: "text-emerald-500",
    bgClass: "bg-emerald-500/10",
    tone: "green",
  };
}
