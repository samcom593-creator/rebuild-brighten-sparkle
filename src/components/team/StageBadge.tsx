import { cn } from "@/lib/utils";
import { STAGES, STAGE_UNSET_LABEL, stageLabel, type StageKey } from "@/lib/teamStage";

/** The small stage badge beside a name. "Stage not set" is visible, never blank, so staff can see who needs placing. */
export function StageBadge({ stage, className }: { stage: StageKey | null | undefined; className?: string }) {
  const set = !!stage;
  return (
    <span className={cn("inline-flex h-5 shrink-0 items-center rounded-full border px-1.5 text-[11px] font-semibold",
      set ? "border-primary/40 bg-primary/10 text-foreground" : "border-dashed border-muted-foreground/50 text-muted-foreground", className)}>
      {stageLabel(stage)}
    </span>
  );
}

/** The stage selector: one native select with an accessible name, saving on change. */
export function StageSelect({ name, stage, canEdit, saving, onChange }: {
  name: string; stage: StageKey | null; canEdit: boolean; saving: boolean; onChange: (stage: StageKey) => void;
}) {
  if (!canEdit) return <StageBadge stage={stage} />;
  return (
    <select
      aria-label={`Stage for ${name}`}
      value={stage ?? ""}
      disabled={saving}
      onChange={(e) => { if (e.target.value) onChange(e.target.value as StageKey); }}
      className={cn("h-10 max-w-full rounded-md border bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]",
        stage ? "border-input" : "border-dashed border-muted-foreground/60")}
    >
      {!stage ? <option value="">{STAGE_UNSET_LABEL}</option> : null}
      {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
    </select>
  );
}
