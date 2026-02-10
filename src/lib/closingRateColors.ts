/**
 * Shared closing rate color logic
 * Thresholds:
 * - 0-40% = Red (poor)
 * - 40-60% = Yellow (needs improvement)
 * - 60-100% = Green (excellent)
 */

export function getClosingRateColor(rate: number): {
  textClass: string;
  bgClass: string;
  tone: "red" | "yellow" | "green";
} {
  if (rate < 40) {
    return {
      textClass: "text-red-500",
      bgClass: "bg-red-500/10",
      tone: "red",
    };
  }
  if (rate < 60) {
    return {
      textClass: "text-yellow-500",
      bgClass: "bg-yellow-500/10",
      tone: "yellow",
    };
  }
  return {
    textClass: "text-green-500",
    bgClass: "bg-green-500/10",
    tone: "green",
  };
}
