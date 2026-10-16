// ResellWork — what a sold or objection call means for reselling, and the buttons to work it.
//
// Sam (2026-10-16): make reselling as easy as possible. Mark contacted / resold / push /
// pushback on every call; note who gave SSN and bank; show what the agent said about approval;
// flag mortgage-protection and spouse interest, price and bank objections, and anyone who gave
// SSN + bank and was still declined; show the moments that matter from the transcript instead of
// the full recording.
//
// Signals come from readymode_call_insights (a full read of each transcript, then an independent
// check). Work state is sold_call_work, written only through sold_call_set_status.
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { WORK_LABEL, phx, type ResellFields, type WorkStatus } from "@/lib/resellSignals";

const WORK_TONE: Record<WorkStatus, string> = {
  contacted: "border-sky-500/40 bg-sky-500/10 text-sky-800 dark:text-sky-300",
  resold: "border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300",
  pushed: "border-violet-500/40 bg-violet-500/10 text-violet-800 dark:text-violet-300",
  pushback: "border-amber-500/50 bg-amber-500/10 text-amber-800 dark:text-amber-300",
};

function Chip({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold", tone)}>{children}</span>;
}

const RED = "border-red-500/50 bg-red-500/10 text-red-800 dark:text-red-300";
const GREEN = "border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300";
const AMBER = "border-amber-500/50 bg-amber-500/10 text-amber-800 dark:text-amber-300";
const BLUE = "border-sky-500/40 bg-sky-500/10 text-sky-800 dark:text-sky-300";
const GREY = "border-border bg-muted text-foreground";

/** Badges, key moments and the resell angle for one call. `gaveSsn`/`gaveBank` also accept the packet's own flags. */
export function ResellSignals({ data, gaveSsn, gaveBank, hasTranscript = true }: {
  data: ResellFields;
  gaveSsn?: boolean | null;
  gaveBank?: boolean | null;
  hasTranscript?: boolean;
}) {
  const ssn = Boolean(gaveSsn || data.said_ssn);
  const bank = Boolean(gaveBank || data.said_bank);
  const analyzed = data.approval_status != null;
  const moments = (data.key_moments ?? []).slice(0, 8);
  const opps = data.other_opportunities ?? [];
  return (
    <div className="mt-3 space-y-2">
      <div className="flex flex-wrap gap-1.5" aria-label="What this call means for reselling">
        {data.declined_after_ssn_bank && <Chip tone={RED}>Gave SSN + bank, declined: resell with another carrier</Chip>}
        {ssn && <Chip tone={GREY}>Gave SSN</Chip>}
        {bank && <Chip tone={GREY}>Gave bank</Chip>}
        {data.approval_status === "approved" && <Chip tone={GREEN}>Agent said approved</Chip>}
        {data.approval_status === "declined" && !data.declined_after_ssn_bank && <Chip tone={RED}>Agent said declined</Chip>}
        {data.approval_status === "pending" && <Chip tone={BLUE}>Agent said pending</Chip>}
        {data.approval_status === "not_said" && <Chip tone={GREY}>Approval not said on the call</Chip>}
        {data.mortgage_protection && <Chip tone={AMBER}>Wants mortgage protection</Chip>}
        {data.spouse_coverage && <Chip tone={AMBER}>Asked about the spouse</Chip>}
        {data.price_objection && <Chip tone={AMBER}>Price objection</Chip>}
        {data.bank_objection && <Chip tone={AMBER}>Bank objection</Chip>}
        {data.ssn_objection && <Chip tone={AMBER}>Social objection</Chip>}
        {!analyzed && hasTranscript && <span className="text-xs text-muted-foreground">Reading the transcript for resell signals…</span>}
        {!analyzed && !hasTranscript && <span className="text-xs text-muted-foreground">Transcript coming</span>}
      </div>
      {data.approval_quote && data.approval_status !== "not_said" && (
        <p className="text-xs text-muted-foreground">Agent: “{data.approval_quote}”</p>
      )}
      {data.insight_summary && <p className="text-sm"><span className="font-semibold">Resell angle:</span> {data.insight_summary}</p>}
      {opps.length > 0 && (
        <p className="text-sm"><span className="font-semibold">Also on the call:</span> {opps.join(" · ")}</p>
      )}
      {moments.length > 0 && (
        <section aria-label="Moments that matter">
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Moments that matter</h3>
          <ul className="space-y-1 text-sm">
            {moments.map((m) => (
              <li key={`${m.t}|${m.label}`} className="flex gap-2">
                <span className="w-12 shrink-0 font-mono text-xs tabular-nums text-muted-foreground">{m.t}</span>
                <span><span className="font-semibold">{m.label}:</span> {m.quote}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** Mark contacted / resold / push / pushback, plus a note. A packet's resale also records the policy # on the packet. */
export function WorkActions({ callId, data, packetId, clientLabel }: {
  callId: string;
  data: ResellFields;
  /** Sold calls with a packet: Mark resold also marks the packet resold with the policy # typed. */
  packetId?: string | null;
  clientLabel: string;
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<WorkStatus | "note" | null>(null);
  const [note, setNote] = useState("");
  const [policy, setPolicy] = useState("");
  const status = data.work_status ?? null;

  const save = async (next: WorkStatus | null) => {
    if (busy) return;
    if (!next && !note.trim()) return;
    setBusy(next ?? "note");
    try {
      if (next === "resold" && packetId) {
        const { error } = await (supabase.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<{ error: { message: string } | null }>)(
          "booking_packet_mark_booked", { p_id: packetId, p_policy: policy.trim() },
        );
        if (error) throw new Error(error.message);
      }
      const { error } = await (supabase.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<{ error: { message: string } | null }>)(
        "sold_call_set_status", { p_call_id: callId, p_status: next, p_note: note.trim() || null },
      );
      if (error) throw new Error(error.message);
      toast.success(next ? `${clientLabel}: ${WORK_LABEL[next]}.` : "Note saved.");
      setNote("");
      void qc.invalidateQueries({ queryKey: ["sold-calls-queue"] });
      void qc.invalidateQueries({ queryKey: ["sold-calls-extras"] });
      void qc.invalidateQueries({ queryKey: ["objection-calls"] });
    } catch (e) {
      toast.error(`Not saved: ${e instanceof Error ? e.message : "unknown error"}`);
    } finally {
      setBusy(null);
    }
  };

  const stamps = ([
    ["Contacted", data.contacted_at], ["Pushed", data.pushed_at], ["Pushback", data.pushback_at], ["Resold", data.resold_at],
  ] as const).filter(([, at]) => at);
  const latestNote = data.work_note?.split("\n").slice(0, 3) ?? [];
  const buttons: Array<{ s: WorkStatus; label: string }> = [
    { s: "contacted", label: "Mark contacted" },
    { s: "resold", label: "Mark resold" },
    { s: "pushed", label: "Mark push" },
    { s: "pushback", label: "Mark pushback" },
  ];

  return (
    <div className="mt-4 space-y-2 border-t border-border/60 pt-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {status ? <Chip tone={WORK_TONE[status]}>{WORK_LABEL[status]}</Chip> : <Chip tone={GREY}>Not worked yet</Chip>}
        {stamps.map(([label, at]) => <span key={label}>{label} {phx(at)}</span>)}
      </div>
      {latestNote.length > 0 && (
        <ul className="space-y-0.5 text-xs text-muted-foreground">{latestNote.map((n, i) => <li key={`${i}|${n}`}>{n}</li>)}</ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {buttons.map(({ s, label }) => (
          <Button key={s} size="sm" className="h-9" variant={status === s ? "default" : "outline"} disabled={busy !== null} onClick={() => void save(s)}>
            {busy === s && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />}
            {label}
          </Button>
        ))}
        {packetId && (
          <Input
            value={policy}
            onChange={(e) => setPolicy(e.target.value)}
            placeholder="New policy # (for Mark resold)"
            aria-label={`New policy number for ${clientLabel}`}
            className="h-9 w-56"
            disabled={busy !== null}
          />
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note: what they said, when to call back"
          aria-label={`Note for ${clientLabel}`}
          className="h-9 min-w-[220px] flex-1"
          maxLength={2000}
          disabled={busy !== null}
          onKeyDown={(e) => { if (e.key === "Enter" && note.trim()) void save(null); }}
        />
        <Button size="sm" variant="ghost" className="h-9" disabled={busy !== null || !note.trim()} onClick={() => void save(null)}>
          {busy === "note" && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />}
          Save note
        </Button>
      </div>
    </div>
  );
}
