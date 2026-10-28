import { cn } from "@/lib/utils";
import type { RowStatus, StatusTone } from "@/components/pipeline/worklist/worklistStatus";

const TONES: Record<StatusTone, string> = {
  danger: "border-destructive/40 bg-destructive/10 text-destructive",
  warning: "border-warning/40 bg-warning/10 text-warning",
  primary: "border-primary/40 bg-primary/10 text-primary",
  neutral: "border-border bg-muted/40 text-muted-foreground",
};

/** A status in words with a tint behind it. The words carry the meaning; the tint only helps. */
export function StatusPill({ status, className }: { status: RowStatus; className?: string }) {
  if (!status.label) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[13px] font-medium leading-5",
        TONES[status.tone],
        className,
      )}
    >
      {status.label}
    </span>
  );
}
