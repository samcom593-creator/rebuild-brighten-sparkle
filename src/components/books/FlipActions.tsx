// FlipActions — the call-outcome buttons for one book policy: No answer, Callback,
// Appointment, Resold, the rarer outcomes behind More, Note, and Back to call list.
// Shared by Book Flips cards and Book of Business rows so both pages work a client
// the same way and record it in the same place (book_flip_set).
import { useState } from "react";
import { CalendarClock, Loader2, RotateCcw, StickyNote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SubmitDealDialog, type PostedDealReceipt } from "@/components/deals/SubmitDealDialog";
import type { FlipStatus } from "@/lib/bookFlips";

export interface FlipSetOptions {
  countAttempt?: boolean;
  note?: string;
  callbackAt?: string;
  receipt?: PostedDealReceipt;
}

/** Default callback: two hours from now, on the quarter hour, in the device's local time. */
function defaultCallbackLocal(): string {
  const d = new Date(Date.now() + 2 * 3600_000);
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function FlipActions({ idBase, status, busy, client, onSet, resoldVariant = "default" }: {
  /** Unique per policy; used for the callback and note field ids. */
  idBase: string;
  status: FlipStatus;
  busy: boolean;
  client: { firstName: string; lastName: string; phone: string; dob: string };
  onSet: (status: FlipStatus, opts?: FlipSetOptions) => Promise<boolean>;
  /**
   * The Resold trigger's look. A list that shows these buttons on every card (Book Flips, Easy Resells)
   * passes "outline", so the screen keeps its one gold button (the first card's Call).
   */
  resoldVariant?: "default" | "outline";
}) {
  const [panel, setPanel] = useState<"none" | "callback" | "note" | "more">("none");
  const [cb, setCb] = useState(defaultCallbackLocal);
  const [note, setNote] = useState("");
  const domId = idBase.replace(/[^a-zA-Z0-9_-]/g, "-");

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void onSet("no_answer", { countAttempt: true })}>No answer</Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => setPanel(panel === "callback" ? "none" : "callback")}>
          <CalendarClock className="mr-1 h-4 w-4" aria-hidden /> Callback
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void onSet("appointment", { countAttempt: true })}>Appointment</Button>
        <SubmitDealDialog
          trigger={<Button size="sm" variant={resoldVariant} disabled={busy}>Resold</Button>}
          title="Post the new policy"
          description="Posting counts the sale in production and marks this policy resold."
          initialClient={client}
          onPosted={(receipt) => void onSet("resold", { countAttempt: true, receipt })}
          secondaryAction={{ label: "Already posted: just mark resold", onClick: () => void onSet("resold", { countAttempt: true }) }}
        />
        {/* The three rare outcomes sit behind one tap so a card reads as a call, not a control panel. */}
        <Button size="sm" variant="ghost" disabled={busy} aria-expanded={panel === "more"} onClick={() => setPanel(panel === "more" ? "none" : "more")}>
          {panel === "more" ? "Fewer" : "More…"}
        </Button>
        {panel === "more" && (
          <>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void onSet("not_interested", { countAttempt: true })}>Not interested</Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void onSet("bad_number", { countAttempt: true })}>Bad number</Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void onSet("do_not_call")}>Do not call</Button>
          </>
        )}
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => setPanel(panel === "note" ? "none" : "note")}>
          <StickyNote className="mr-1 h-4 w-4" aria-hidden /> Note
        </Button>
        {status !== "to_call" && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void onSet("to_call")}>
            <RotateCcw className="mr-1 h-4 w-4" aria-hidden /> Back to call list
          </Button>
        )}
        {busy && <Loader2 className="h-5 w-5 animate-spin self-center text-muted-foreground" aria-label="Saving" />}
      </div>

      {panel === "callback" && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-border p-3">
          <label className="text-sm text-muted-foreground" htmlFor={`cb-${domId}`}>Call back at</label>
          <input
            id={`cb-${domId}`}
            type="datetime-local"
            value={cb}
            onChange={(e) => setCb(e.target.value)}
            className="h-10 rounded-md border border-input bg-background px-2 text-base text-foreground"
          />
          <Button
            size="sm"
            disabled={busy || !cb}
            onClick={async () => {
              const at = new Date(cb);
              if (Number.isNaN(at.getTime())) return;
              if (await onSet("callback", { countAttempt: true, callbackAt: at.toISOString() })) setPanel("none");
            }}
          >
            Save callback
          </Button>
        </div>
      )}
      {panel === "note" && (
        <div className="mt-3 flex flex-col gap-2 rounded-lg border border-border p-3">
          <label className="sr-only" htmlFor={`note-${domId}`}>Note</label>
          <textarea
            id={`note-${domId}`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={2000}
            rows={3}
            placeholder="What happened on the call?"
            className="rounded-md border border-input bg-background p-2 text-base text-foreground"
          />
          <Button
            size="sm"
            className="self-start"
            disabled={busy || !note.trim()}
            onClick={async () => {
              // Keep the typed note until the save lands, so a failed save never loses it.
              if (await onSet(status, { note: note.trim() })) {
                setNote("");
                setPanel("none");
              }
            }}
          >
            Save note
          </Button>
        </div>
      )}
    </>
  );
}
