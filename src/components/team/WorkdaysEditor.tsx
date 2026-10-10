import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { WEEKDAYS, phoenixToday, workdaysSummary } from "@/lib/teamStage";

/**
 * Five weekday checkboxes (Monday to Friday) and the derived summary. Saving is prospective: it takes effect today, or on
 * a later date the user picks. It never changes a past day, and it is a plan, not attendance.
 */
export function WorkdaysEditor({ name, weekdays, scheduleSet, nextSchedule, canEdit, saving, onSave, onEditingChange }: {
  name: string;
  weekdays: number[] | null;
  scheduleSet: boolean;
  nextSchedule: { effective_from: string; weekdays: number[] } | null;
  canEdit: boolean;
  saving: boolean;
  onSave: (weekdays: number[], effectiveFrom?: string) => Promise<boolean>;
  onEditingChange?: (editing: boolean) => void;
}) {
  const current = scheduleSet ? weekdays ?? [] : null;
  const [draft, setDraft] = useState<number[]>(current ?? []);
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [from, setFrom] = useState("");
  // Keep the draft through optimistic saves, rollbacks and background refreshes.
  // The parent unmounts this editor when explicitly switching people.
  useEffect(() => { onEditingChange?.(touched || saving); }, [touched, saving, onEditingChange]);
  useEffect(() => () => onEditingChange?.(false), [onEditingChange]);
  const dirty = current === null || draft.join(",") !== [...current].sort().join(",");
  const today = phoenixToday();
  const toggle = (n: number) => { setTouched(true); setError(null); setDraft((d) => (d.includes(n) ? d.filter((x) => x !== n) : [...d, n].sort((a, b) => a - b))); };
  const save = async () => {
    if (from && from < today) { setError("Choose today or a future start date."); return; }
    try {
      if (await onSave(draft, from || undefined)) { setTouched(false); setError(null); }
      else setError("Schedule did not save. Your selected days are still here; try again.");
    } catch { setError("Schedule did not save. Your selected days are still here; try again."); }
  };

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
              <input type="date" value={from} min={today} onChange={(e) => { setFrom(e.target.value); setTouched(true); setError(null); }} aria-label={`Start date for ${name}'s schedule (blank means today)`}
                className="ml-1 h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground" />
            </label>
            <Button type="button" size="sm" className="h-9" disabled={!dirty && !from} onClick={() => void save()}>
              {saving ? "Saving…" : from ? `Save from ${from}` : "Save"}
            </Button>
            {touched ? <Button type="button" variant="ghost" size="sm" onClick={() => { setDraft(current ?? []); setFrom(""); setTouched(false); setError(null); }}>Discard edit</Button> : null}
            <span className="text-xs text-muted-foreground">Preview: {workdaysSummary(draft)}</span>
          </div>
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        </fieldset>
      ) : null}
    </div>
  );
}
