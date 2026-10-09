import { useEffect, useRef, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { clearPackTicks, parsePack, togglePackItem } from "@/lib/contentFilmingPack";
import { LIFECYCLE_LABEL, lifecycleOf, nextAction } from "@/lib/contentWorkflow";
import { cn } from "@/lib/utils";

export interface PackCard {
  id: string; title: string; status: string; hook?: string | null; clip?: string | null; record_script?: string | null; caption?: string | null;
  published_url?: string | null; publish_evidence?: string | null; due_date?: string | null; day?: number | null; brief?: Record<string, unknown> | null;
}

const HEADING = /^[A-Z][A-Z ]{3,}$/;

/**
 * The filming pack for one project, readable and tickable on a phone. Each tick saves straight away; saves are queued
 * so two quick taps cannot race, and a save that fails says so and keeps the tick on screen with a Retry, rather than
 * pretending it worked. The text is the card's own record_script, so the pack survives a refresh and stays editable.
 */
export function FilmingPackSheet({ card, open, onOpenChange, onSave, onOpenEditor }: {
  card: PackCard | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Persist the text. Resolve true only when the database now holds it. */
  onSave: (cardId: string, text: string) => Promise<boolean>;
  onOpenEditor: (cardId: string) => void;
}) {
  const [text, setText] = useState(card?.record_script ?? "");
  const [status, setStatus] = useState<"saved" | "saving" | "error">("saved");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const textRef = useRef(text);
  const inFlight = useRef(false);
  const pending = useRef<string | null>(null);
  const cardId = card?.id ?? null;

  useEffect(() => {
    const next = card?.record_script ?? "";
    textRef.current = next; setText(next); setStatus("saved"); setEditing(false);
    // Reset only when a different project is shown; a later refresh of the same project must not overwrite local ticks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardId]);

  const persist = async (next: string) => {
    if (!cardId) return;
    textRef.current = next; setText(next); setStatus("saving");
    if (inFlight.current) { pending.current = next; return; }
    inFlight.current = true;
    let ok = await onSave(cardId, next);
    while (pending.current !== null) { const p = pending.current; pending.current = null; ok = await onSave(cardId, p); }
    inFlight.current = false;
    setStatus(ok ? "saved" : "error");
  };

  if (!card) return null;
  const progress = parsePack(text);
  // The pack is a fixed document: a line's number is its identity, and ticking a line never reorders anything.
  const rows = text.split("\n").map((line, n) => ({ line, n, id: `pack-line-${n}` }));
  const stage = lifecycleOf({ status: card.status, clip: card.clip ?? "", record_script: text, published_url: card.published_url, publish_evidence: card.publish_evidence });
  const brief = (card.brief ?? {}) as { premise?: string; payoff?: string; reason?: string };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto p-4 sm:max-w-lg sm:p-6" aria-describedby="pack-desc">
        <SheetHeader className="pr-10">
          <SheetTitle className="text-xl leading-snug">{card.title}</SheetTitle>
          <SheetDescription id="pack-desc">
            {LIFECYCLE_LABEL[stage]} · {nextAction({ id: card.id, title: card.title, status: card.status, hook: card.hook, record_script: text, clip: card.clip, caption: card.caption, published_url: card.published_url, publish_evidence: card.publish_evidence })}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          {brief.premise || brief.payoff ? (
            <div className="space-y-1 rounded-md border border-border bg-muted/30 p-3 text-sm">
              {brief.premise ? <p><b className="text-foreground">The idea:</b> <span className="text-muted-foreground">{brief.premise}</span></p> : null}
              {brief.payoff ? <p><b className="text-foreground">The viewer gets:</b> <span className="text-muted-foreground">{brief.payoff}</span></p> : null}
            </div>
          ) : null}

          <div>
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="font-semibold text-foreground">{progress.total === 0 ? "No checklist yet" : `${progress.done} of ${progress.total} done`}</span>
              <span role="status" className={cn("text-xs", status === "error" ? "font-semibold text-destructive" : "text-muted-foreground")}>
                {status === "saving" ? <span className="inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" aria-hidden />Saving</span>
                  : status === "error" ? <>Not saved. <button type="button" className="underline" onClick={() => void persist(textRef.current)}>Retry</button></>
                  : <span className="inline-flex items-center gap-1"><Check className="h-3 w-3" aria-hidden />Saved</span>}
              </span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
              <div className="h-full rounded-full bg-primary" style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }} />
            </div>
          </div>

          {editing ? (
            <div className="space-y-2">
              <label className="block text-sm text-muted-foreground">Pack text
                <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={16} className="mt-1 w-full rounded-md border border-border bg-background p-3 font-mono text-sm text-foreground" />
              </label>
              <p className="text-xs text-muted-foreground">Lines that start with “- [ ]” are checklist items. Everything else is free text.</p>
              <div className="flex gap-2">
                <Button className="h-11" onClick={() => { void persist(draft); setEditing(false); }}>Save text</Button>
                <Button variant="ghost" className="h-11" onClick={() => setEditing(false)}>Cancel</Button>
              </div>
            </div>
          ) : progress.total === 0 && !text.trim() ? (
            <p className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">This project has no filming pack yet. Open the editor to add one.</p>
          ) : (
            <ul className="space-y-1" aria-label="Filming pack">
              {rows.map(({ line, n, id }) => {
                const item = progress.items.find((x) => x.line === n);
                if (item) {
                  return (
                    <li key={id}>
                      <button type="button" role="checkbox" aria-checked={item.checked}
                        onClick={() => void persist(togglePackItem(textRef.current, n))}
                        className={cn("flex min-h-[48px] w-full items-start gap-3 rounded-md border px-3 py-2 text-left text-base", item.checked ? "border-border bg-muted/30 text-muted-foreground line-through" : "border-border bg-card text-foreground hover:border-primary")}>
                        <span aria-hidden className={cn("mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded border", item.checked ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground")}>
                          {item.checked ? <Check className="h-4 w-4" /> : null}
                        </span>
                        <span>{item.text}</span>
                      </button>
                    </li>
                  );
                }
                if (!line.trim()) return null;
                return HEADING.test(line.trim())
                  ? <li key={id} className="pt-3 text-sm font-semibold tracking-wide text-foreground" role="presentation">{line.trim()}</li>
                  : <li key={id} className="px-1 text-sm text-muted-foreground" role="presentation">{line}</li>;
              })}
            </ul>
          )}

          <div className="flex flex-wrap gap-2 border-t border-border pt-3">
            <Button variant="outline" className="h-11" onClick={() => { setDraft(text); setEditing(true); }}>Edit text</Button>
            {progress.done > 0 ? <Button variant="ghost" className="h-11" onClick={() => void persist(clearPackTicks(textRef.current))}>Clear ticks for a re-shoot</Button> : null}
            <Button variant="ghost" className="h-11" onClick={() => onOpenEditor(card.id)}>Open the full card</Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
