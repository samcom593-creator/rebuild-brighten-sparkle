import { cn } from "@/lib/utils";
import { FLAG_META, type HirePriorityRow } from "@/lib/hireFlags";

/**
 * Red chips for the steps a hire is overdue on. Only overdue steps render, in red, so a glance shows what is
 * wrong. Nothing renders when nothing is overdue: absence is the all-clear, and the caller decides whether to
 * explain it.
 */
export function HireFlagChips({ row, className }: { row: Pick<HirePriorityRow, "aflac" | "ethos" | "first_contract" | "agentlink">; className?: string }) {
  const red = FLAG_META.filter((f) => row[f.key]);
  if (red.length === 0) return null;
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1.5", className)}>
      {red.map((f) => (
        <span
          key={f.key}
          className="inline-flex items-center gap-1 rounded-full border border-red-500/50 bg-red-500/15 px-2.5 py-0.5 text-xs font-bold text-red-300"
          title={`${f.label} is overdue (past day ${f.after})`}
        >
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-red-400" />
          {f.label}
        </span>
      ))}
    </span>
  );
}
