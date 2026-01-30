/**
 * Shared closing rate color logic
 * Thresholds:
 * - < 40% = Red (poor)
 * - 40-55% = Yellow (needs improvement)
 * - > 55% = Green (excellent)
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
  if (rate <= 55) {
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
