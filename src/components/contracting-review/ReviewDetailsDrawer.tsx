import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import { externalHref } from "@/lib/externalHref";
import {
  INTAKE_LABEL, US_STATES, levelText, markSentence, npnProblem,
  type IntakeField, type IntakeValues, type ProfileResult, type ReviewAgent, type ReviewCarrier,
} from "@/lib/contractReview";
import { CarrierCircle } from "@/components/contracting-review/CarrierCircle";

interface HistoryEvent { id: number; event_type: string; carrier_key: string | null; detail: Record<string, unknown> | null; acted_at: string; acted_by_name: string }

function historyLine(e: HistoryEvent, carriers: readonly ReviewCarrier[]): string {
  const label = carriers.find((c) => c.key === e.carrier_key)?.label ?? e.carrier_key ?? "";
  switch (e.event_type) {
    case "marked": return `${label} confirmed`;
    case "cleared": return `${label} cleared (back to Not yet reviewed)`;
    case "level_set": return e.detail?.from == null ? `Level set to ${e.detail?.to}%` : `Level ${e.detail.from}% to ${e.detail?.to}%`;
    case "level_cleared": return "Level cleared";
    case "intake_saved": return "Contracting profile saved";
    default: return e.event_type;
  }
}

const whenOf = (iso: string): string => new Intl.DateTimeFormat("en-US", { timeZone: "America/Phoenix", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));

function valuesOf(a: ReviewAgent): { values: IntakeValues; prefilled: boolean } {
  const p = a.profile;
  const [first = "", ...rest] = (a.display_name || "").split(" ");
  const fromName = !p.first_name && !p.last_name && a.display_name !== "Name not on file";
  const values: IntakeValues = {
    npn: p.npn ?? "",
    first_name: p.first_name ?? (fromName ? first : ""),
    last_name: p.last_name ?? (fromName ? rest.join(" ") : ""),
    email: p.email ?? a.email ?? "",
    resident_state: p.resident_state ?? p.state_hint ?? "",
  };
  const prefilled = (!p.first_name && !!values.first_name) || (!p.email && !!values.email) || (!p.resident_state && !!values.resident_state);
  return { values, prefilled };
}

export function ReviewDetailsDrawer({ open, onOpenChange, agent, carriers, canEdit, isSaving, onToggle, onSaveProfile, onSetLevel, onSaveAndNext, hasNext }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agent: ReviewAgent | undefined;
  carriers: readonly ReviewCarrier[];
  canEdit: boolean;
  isSaving: (agentId: string, what: string) => boolean;
  onToggle: (agent: ReviewAgent, carrier: ReviewCarrier, confirmed: boolean) => void;
  onSaveProfile: (agentId: string, v: IntakeValues) => Promise<ProfileResult>;
  onSetLevel: (agentId: string, pct: number | null) => Promise<{ ok: boolean; error: string | null }>;
  /** Moves on to the next person with an Unmarked circle. The drawer does not close until the parent decides. */
  onSaveAndNext: (agentId: string) => void;
  hasNext: boolean;
}) {
  const { isAdmin } = useAuth();
  const initial = useMemo(() => (agent ? valuesOf(agent) : null), [agent?.agent_id, agent?.profile.npn, agent?.profile.first_name, agent?.profile.last_name, agent?.profile.email, agent?.profile.resident_state]); // eslint-disable-line react-hooks/exhaustive-deps
  const [values, setValues] = useState<IntakeValues>({ npn: "", first_name: "", last_name: "", email: "", resident_state: "" });
  const [problem, setProblem] = useState<{ field: IntakeField | null; text: string } | null>(null);
  const [levelInput, setLevelInput] = useState("");
  const [levelError, setLevelError] = useState<string | null>(null);

  // Reset the editor only when a different person (or a saved value) arrives, never on a mere re-render.
  useEffect(() => { if (initial) { setValues(initial.values); setProblem(null); } }, [initial]);
  useEffect(() => { setLevelInput(agent?.level ? String(agent.level.pct) : ""); setLevelError(null); }, [agent?.agent_id, agent?.level?.pct]);

  const history = useQuery({
    queryKey: ["contract-review-history", agent?.agent_id, agent?.marked_count, agent?.level?.pct, agent?.profile.npn],
    enabled: open && !!agent,
    staleTime: 10_000,
    queryFn: async (): Promise<HistoryEvent[]> => {
      const { data, error } = await supabase.rpc("contract_review_history", { p_agent_id: agent!.agent_id, p_limit: 20 });
      if (error) throw new Error(error.message);
      const r = data as unknown as { ok?: boolean; events?: HistoryEvent[] } | null;
      if (!r?.ok || !Array.isArray(r.events)) throw new Error("History did not load.");
      return r.events;
    },
  });

  if (!agent) return null;
  const dirty = initial ? (Object.keys(values) as IntakeField[]).some((k) => values[k] !== initial.values[k]) : false;
  const savingProfile = isSaving(agent.agent_id, "profile");
  const set = (k: IntakeField, v: string) => { setValues((s) => ({ ...s, [k]: v })); if (problem?.field === k) setProblem(null); };

  const save = async (): Promise<boolean> => {
    const npnIssue = npnProblem(values.npn);
    if (npnIssue) { setProblem({ field: "npn", text: npnIssue }); return false; }
    const r = await onSaveProfile(agent.agent_id, values);
    if (r.ok) { setProblem(null); return true; }
    setProblem({ field: (r.field as IntakeField | null) ?? null, text: r.error ?? "Not saved." });
    return false;
  };
  const saveAndNext = async () => {
    if (canEdit && dirty && !(await save())) return;
    onSaveAndNext(agent.agent_id);
  };
  const submitLevel = async () => {
    const n = Number(levelInput);
    if (!levelInput.trim() || !Number.isFinite(n) || n < 0 || n > 200) { setLevelError("Enter a number from 0 to 200."); return; }
    const r = await onSetLevel(agent.agent_id, n);
    setLevelError(r.ok ? null : r.error);
  };

  const field = (k: IntakeField, el: React.ReactNode) => (
    <div className="space-y-1">
      <Label htmlFor={`review-${k}`} className="text-xs">{INTAKE_LABEL[k]}</Label>
      {el}
      {problem?.field === k ? <p role="alert" className="text-xs text-destructive">{problem.text}</p> : null}
    </div>
  );
  const common = { disabled: !canEdit || savingProfile };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-lg">
        <SheetHeader className="space-y-1 border-b border-border p-4 text-left">
          <SheetTitle className="text-lg">{agent.display_name}</SheetTitle>
          <SheetDescription>{agent.email ?? "No email on file"}{agent.manager_name ? ` · Team: ${agent.manager_name}` : ""}</SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-5 p-4">
          <section aria-label="Carriers" className="space-y-2">
            <h3 className="text-sm font-semibold text-foreground">Carriers</h3>
            <p className="text-xs text-muted-foreground">Contracting happens in each carrier&apos;s own portal. Confirm a circle here only after you have checked it yourself. Opening a portal does not mark anything.</p>
            <ul className="divide-y divide-border rounded-lg border border-border">
              {carriers.map((c) => (
                <li key={c.key} className="flex items-center gap-3 px-3 py-2">
                  <CarrierCircle carrier={c} mark={agent.marks[c.key] ?? null} canEdit={canEdit} saving={isSaving(agent.agent_id, c.key)} onToggle={(v) => onToggle(agent, c, v)} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">{c.label}</p>
                    <p className="text-xs text-muted-foreground">{markSentence(agent.marks[c.key] ?? null)}</p>
                  </div>
                  {externalHref(c.portal_url) ? (
                    <a href={externalHref(c.portal_url) ?? undefined} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[40px] items-center gap-1 rounded-md px-2 text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]">
                      Open portal <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
            {!canEdit ? <p className="text-xs text-muted-foreground">View only. Admins and managers confirm carriers.</p> : null}
          </section>

          <section aria-label="Placement level" className="space-y-2 border-t border-border pt-4">
            <h3 className="text-sm font-semibold text-foreground">Placement level</h3>
            <p className="text-xs text-muted-foreground">One agent-wide level, the same one used for commission. Currently: <span className="font-medium text-foreground">{levelText(agent.level)}</span>.</p>
            <div className="flex items-start gap-2">
              <div className="space-y-1">
                <Label htmlFor="review-level" className="sr-only">Placement level percent</Label>
                <Input id="review-level" inputMode="decimal" className="h-10 w-28" placeholder="Not set" value={levelInput} disabled={!canEdit || isSaving(agent.agent_id, "level")} onChange={(e) => { setLevelInput(e.target.value); setLevelError(null); }} onKeyDown={(e) => { if (e.key === "Enter") void submitLevel(); }} />
                {levelError ? <p role="alert" className="text-xs text-destructive">{levelError}</p> : null}
              </div>
              <Button type="button" size="sm" className="h-10" disabled={!canEdit || isSaving(agent.agent_id, "level")} onClick={() => void submitLevel()}>Set level</Button>
              {isAdmin && agent.level ? <Button type="button" size="sm" variant="ghost" className="h-10" disabled={isSaving(agent.agent_id, "level")} onClick={() => void onSetLevel(agent.agent_id, null).then((r) => setLevelError(r.ok ? null : r.error))}>Clear</Button> : null}
            </div>
          </section>

          <section aria-label="Contracting profile" className="space-y-3 border-t border-border pt-4">
            <h3 className="text-sm font-semibold text-foreground">Contracting profile</h3>
            {initial?.prefilled ? <p className="text-xs text-muted-foreground">Some fields are filled from the agent&apos;s existing profile. Check them, then save.</p> : null}
            <div className="grid gap-3 sm:grid-cols-2">
              {field("first_name", <Input id="review-first_name" autoComplete="off" value={values.first_name} onChange={(e) => set("first_name", e.target.value)} {...common} aria-invalid={problem?.field === "first_name" || undefined} />)}
              {field("last_name", <Input id="review-last_name" autoComplete="off" value={values.last_name} onChange={(e) => set("last_name", e.target.value)} {...common} aria-invalid={problem?.field === "last_name" || undefined} />)}
            </div>
            {field("email", <Input id="review-email" type="email" autoComplete="off" value={values.email} onChange={(e) => set("email", e.target.value)} {...common} aria-invalid={problem?.field === "email" || undefined} />)}
            <div className="grid gap-3 sm:grid-cols-2">
              {field("npn", <Input id="review-npn" inputMode="numeric" autoComplete="off" value={values.npn} onChange={(e) => set("npn", e.target.value)} {...common} aria-invalid={problem?.field === "npn" || undefined} />)}
              {field("resident_state", (
                <select id="review-resident_state" value={values.resident_state} onChange={(e) => set("resident_state", e.target.value)} disabled={common.disabled}
                  className={cn("h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground", "focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]")}>
                  <option value="">Choose a state</option>
                  {US_STATES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
                </select>
              ))}
            </div>
            {problem && !problem.field ? <p role="alert" className="text-xs text-destructive">{problem.text}</p> : null}
            <Button type="button" size="sm" className="h-10" disabled={!canEdit || !dirty || savingProfile} onClick={() => void save()}>
              {savingProfile ? "Saving…" : dirty ? "Save profile" : "Saved"}
            </Button>
            <p className="text-xs text-muted-foreground">Saving this profile does not mean carrier contracting is complete.</p>
          </section>

          <section aria-label="History" className="space-y-2 border-t border-border pt-4">
            <h3 className="text-sm font-semibold text-foreground">History</h3>
            {history.isLoading ? <p className="text-xs text-muted-foreground">Loading…</p> : null}
            {history.isError ? <p role="alert" className="text-xs text-destructive">History did not load. <button type="button" className="underline" onClick={() => void history.refetch()}>Retry</button></p> : null}
            {history.data && history.data.length === 0 ? <p className="text-xs text-muted-foreground">No changes recorded yet.</p> : null}
            <ul className="space-y-1">
              {(history.data ?? []).map((e) => (
                <li key={e.id} className="text-xs text-muted-foreground"><span className="text-foreground">{historyLine(e, carriers)}</span> · {e.acted_by_name} · {whenOf(e.acted_at)}</li>
              ))}
            </ul>
          </section>
        </div>

        <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-border bg-background p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <Button type="button" className="h-10" disabled={savingProfile} onClick={() => void saveAndNext()}>
            {hasNext ? (canEdit && dirty ? "Save & Next" : "Next unreviewed") : (canEdit && dirty ? "Save" : "Done")}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
