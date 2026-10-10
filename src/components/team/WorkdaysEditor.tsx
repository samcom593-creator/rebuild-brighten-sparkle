import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { WEEKDAYS, phoenixToday, workdaysSummary } from "@/lib/teamStage";

/**
 * Five weekday checkboxes (Monday to Friday) and the derived summary. Saving is prospective: it takes effect today, or on
 * a later date the user picks. It never changes a past day, and it is a plan, not attendance.
 */
export function WorkdaysEditor({ name, weekdays, scheduleSet, nextSchedule, canEdit, saving, onSave }: {
  name: string;
  weekdays: number[] | null;
  scheduleSet: boolean;
  nextSchedule: { effective_from: string; weekdays: number[] } | null;
  canEdit: boolean;
  saving: boolean;
  onSave: (weekdays: number[], effectiveFrom?: string) => void;
}) {
  const current = scheduleSet ? weekdays ?? [] : null;
  const [draft, setDraft] = useState<number[]>(current ?? []);
  const [from, setFrom] = useState("");
  useEffect(() => { setDraft(current ?? []); }, [scheduleSet, (weekdays ?? []).join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = current === null || draft.join(",") !== [...current].sort().join(",");
  const today = phoenixToday();
  const toggle = (n: number) => setDraft((d) => (d.includes(n) ? d.filter((x) => x !== n) : [...d, n].sort((a, b) => a - b)));

  return (
    <div className="space-y-2">
      <p className="text-sm text-foreground">{workdaysSummary(current)}</p>
      {nextSchedule ? <p className="text-xs text-muted-foreground">From {nextSchedule.effective_from}: {workdaysSummary(nextSchedule.weekdays)}</p> : null}
      {canEdit ? (
        <fieldset className="space-y-2" disabled={saving}>
          <legend className="sr-only">Work days for {name}</legend>
          <div className="flex flex-wrap gap-1.5">
            {WEEKDAYS.map((w) => {
              const on = draft.includes(w.n);
              return (
                <label key={w.n} className={cn("inline-flex min-h-[40px] cursor-pointer items-center gap-1.5 rounded-full border px-3 text-sm font-medium",
                  on ? "border-primary bg-primary/10 text-foreground" : "border-border bg-card text-muted-foreground")}>
                  <input type="checkbox" className="h-4 w-4 accent-[hsl(var(--primary))]" checked={on} onChange={() => toggle(w.n)} aria-label={`${w.long} for ${name}`} />
                  {w.short}
                </label>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs text-muted-foreground">
              Starting
              <input type="date" value={from} min={today} onChange={(e) => setFrom(e.target.value)} aria-label={`Start date for ${name}'s schedule (blank means today)`}
                className="ml-1 h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground" />
            </label>
            <Button type="button" size="sm" className="h-9" disabled={!dirty && !from} onClick={() => onSave(draft, from || undefined)}>
              {saving ? "Saving…" : from ? `Save from ${from}` : "Save"}
            </Button>
            <span className="text-xs text-muted-foreground">Preview: {workdaysSummary(draft)}</span>
          </div>
        </fieldset>
      ) : null}
    </div>
  );
}
