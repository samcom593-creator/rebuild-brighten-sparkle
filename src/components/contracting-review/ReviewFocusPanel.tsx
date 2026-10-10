import { useEffect, useState } from "react";
import { ArrowRight, ExternalLink, Pencil, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { externalHref } from "@/lib/externalHref";
import { levelText, markSentence, type ReviewAgent, type ReviewCarrier } from "@/lib/contractReview";
import { CarrierCircle } from "./CarrierCircle";

const accents = ["border-sky-500/25 bg-sky-500/5", "border-violet-500/25 bg-violet-500/5", "border-amber-500/25 bg-amber-500/5", "border-emerald-500/25 bg-emerald-500/5"];

/** Uses the same marks and agent-wide level as the compact roster. No second data model. */
export function ReviewFocusPanel({ agent, carriers, canEdit, isSaving, onToggle, onSetLevel, onDetails, onNext, hasNext, onEditingChange }: {
  agent: ReviewAgent; carriers: readonly ReviewCarrier[]; canEdit: boolean;
  isSaving: (id: string, key: string) => boolean;
  onToggle: (agent: ReviewAgent, carrier: ReviewCarrier, confirmed: boolean) => void;
  onSetLevel: (id: string, pct: number | null) => Promise<{ ok: boolean; error: string | null }>;
  onDetails: () => void; onNext: () => void; hasNext: boolean; onEditingChange: (editing: boolean) => void;
}) {
  const savedLevel = agent.level ? String(agent.level.pct) : "";
  const [draft, setDraft] = useState(savedLevel);
  const [touched, setTouched] = useState(false);
  const level = touched ? draft : savedLevel;
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const dirty = level !== savedLevel;
  const busy = submitting || carriers.some((c) => isSaving(agent.agent_id, c.key)) || isSaving(agent.agent_id, "level");
  useEffect(() => { onEditingChange(dirty || busy); }, [dirty, busy, onEditingChange]);
  useEffect(() => () => onEditingChange(false), [onEditingChange]);
  const saveLevel = async () => {
    const value = Number(level);
    if (!level.trim() || !Number.isFinite(value) || value < 0 || value > 200) { setError("Enter a level from 0 to 200, or discard this edit."); return false; }
    setSubmitting(true);
    try {
      const result = await onSetLevel(agent.agent_id, value);
      setError(result.ok ? null : result.error ?? "Level did not save. Try again.");
      if (result.ok) setTouched(false);
      return result.ok;
    } catch { setError("Level did not save. Your edit is still here; try again."); return false; }
    finally { setSubmitting(false); }
  };
  const next = async () => { if (busy || (dirty && !(await saveLevel()))) return; onNext(); };
  return (
    <article aria-label={`Review ${agent.display_name}`} className="min-w-0 overflow-hidden rounded-2xl border border-border bg-card">
      <div className="space-y-4 border-b border-border bg-primary/5 p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-primary">Carrier review</p>
            <h3 className="break-words text-xl font-semibold tracking-tight text-foreground">{agent.display_name}</h3>
            <p className="mt-1 break-all text-sm text-muted-foreground">{agent.profile.email ?? agent.email ?? "Email not set"}</p>
            <p className="mt-1 text-sm text-muted-foreground">{agent.profile.resident_state ?? "State not set"} · NPN {agent.profile.npn ?? "not set"}</p>
          </div>
          <Button variant="outline" size="sm" className="h-10 gap-1.5" disabled={dirty || busy} onClick={onDetails}><Pencil className="h-4 w-4" aria-hidden /> Profile & history</Button>
        </div>
        <div className="flex items-center gap-3">
          <div role="progressbar" aria-label="Manually confirmed carriers" aria-valuemin={0} aria-valuemax={carriers.length} aria-valuenow={agent.marked_count} className="flex flex-1 gap-1.5">
            {carriers.map((c) => <span key={c.key} className={cn("h-2 flex-1 rounded-full transition-colors motion-reduce:transition-none", agent.marks[c.key] ? "bg-primary" : "bg-primary/15")} />)}
          </div>
          <span className="shrink-0 text-sm font-medium text-foreground">{agent.marked_count} of {carriers.length} confirmed</span>
        </div>
      </div>
      <div className="grid gap-5 p-4 sm:p-6 xl:grid-cols-[minmax(0,1fr)_12rem]">
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">Check the carrier portal, then confirm it here. Each check saves automatically.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {carriers.map((c, i) => {
              const mark = agent.marks[c.key] ?? null;
              const saving = isSaving(agent.agent_id, c.key);
              const portal = externalHref(c.portal_url);
              return <section key={c.key} aria-label={`${c.label} carrier`} className={cn("flex min-w-0 flex-col gap-3 rounded-xl border p-4", accents[i % accents.length])}>
                <div className="flex items-center justify-between gap-2"><h4 className="text-base font-semibold text-foreground">{c.label}</h4><CarrierCircle carrier={c} mark={mark} canEdit={canEdit} saving={saving} onToggle={(v) => onToggle(agent, c, v)} large /></div>
                <div className="flex-1"><p className="text-sm font-medium text-foreground" role="status">{saving ? "Saving…" : mark ? "Confirmed" : "Unmarked"}</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{mark ? markSentence(mark) : "Not yet reviewed"}</p></div>
                {portal ? <a href={portal} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 items-center gap-1.5 self-start rounded-md text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]">Open portal <ExternalLink className="h-3.5 w-3.5" aria-hidden /></a> : <span className="text-xs text-muted-foreground">Portal link not available</span>}
              </section>;
            })}
          </div>
        </div>
        <section aria-label="Agent placement level" className="space-y-3 rounded-xl border border-border bg-muted/20 p-4">
          <h4 className="flex items-center gap-2 text-sm font-semibold text-foreground"><ShieldCheck className="h-4 w-4 text-primary" aria-hidden /> Placement level</h4>
          <p className="text-2xl font-semibold tabular-nums text-foreground">{levelText(agent.level)}</p>
          <p className="text-xs leading-relaxed text-muted-foreground">Agent-wide commission level.</p>
          {canEdit ? <>
            <label className="block space-y-1 text-sm text-foreground"><span>Level (%)</span><Input inputMode="decimal" value={level} disabled={busy} onChange={(e) => { setDraft(e.target.value); setTouched(true); setError(null); }} aria-invalid={!!error} aria-describedby={error ? "focused-level-error" : undefined} placeholder="Not set" /></label>
            {error ? <p id="focused-level-error" role="alert" className="text-sm text-destructive">{error}</p> : null}
            {dirty ? <div className="flex flex-wrap gap-2"><Button size="sm" disabled={busy} onClick={() => void saveLevel()}>Save level</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => { setTouched(false); setError(null); }}>Discard edit</Button></div> : <p className="text-xs text-muted-foreground">{agent.level ? "Saved" : "Not set yet"}</p>}
          </> : null}
        </section>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/20 p-4">
        <p className="text-sm text-muted-foreground" role="status">{busy ? "Saving changes…" : dirty ? "Save or discard your level edit before switching people." : agent.marked_count === carriers.length ? "All four manually confirmed. Review the level before moving on." : "Your confirmations save as you go."}</p>
        <Button className="h-11 gap-2" disabled={busy || !hasNext} onClick={() => void next()}>{hasNext ? dirty ? "Save level & next" : "Next agent" : "No other agents to review"}<ArrowRight className="h-4 w-4" aria-hidden /></Button>
      </div>
    </article>
  );
}
