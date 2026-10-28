import type { LucideIcon } from "lucide-react";

/** Present a confirmed metric; the owning query supplies loading and stale states. */
export function KPIStat({
  icon: Icon,
  label,
  value,
  detail,
  accent,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  detail: string;
  accent?: boolean;
}) {
  return (
    <div className="min-w-0 border-b border-border p-4 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        <Icon className="h-3.5 w-3.5" /> {label}
      </p>
      <p className={accent ? "mt-2 truncate text-3xl font-bold tabular-nums text-primary" : "mt-2 truncate text-3xl font-bold tabular-nums text-foreground"}>
        {value}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

