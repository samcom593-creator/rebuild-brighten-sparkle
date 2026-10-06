import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarClock } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  EXPECTED_START_LABEL,
  EXPECTED_START_STATUSES,
  START_OUTCOME_LABEL,
  currentStartOutcome,
  expectedStartText,
  isExpectedStartStatus,
  phoenixToday,
  type ExpectedStartStatus,
  type OnboardingFacts,
  type StartOutcome,
} from "@/lib/onboardingExceptions";
import { ONBOARDING_FACTS_KEY } from "./useOnboardingExceptionFacts";

type StartFacts = Pick<
  OnboardingFacts,
  "agent_id" | "agent_name" | "expected_start_on" | "expected_start_status" | "start_outcome" | "start_outcome_on"
>;

/**
 * Expected start (Confirmed / Likely / Awaiting response / Not attending) and,
 * once the date has arrived, the actual outcome (Attended / No-show /
 * Rescheduled). Writes go through set_expected_start / record_start_outcome,
 * which audit to agent_stage_moves and never touch employment status: a
 * no-show here does not make anyone inactive or departed.
 */
export function ExpectedStartControl({ facts, compact = false }: { facts: StartFacts; compact?: boolean }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(facts.expected_start_on ?? "");
  const [status, setStatus] = useState<ExpectedStartStatus | "">(isExpectedStartStatus(facts.expected_start_status) ? facts.expected_start_status : "");
  const [note, setNote] = useState("");
  const [newDate, setNewDate] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDate(facts.expected_start_on ?? "");
    setStatus(isExpectedStartStatus(facts.expected_start_status) ? facts.expected_start_status : "");
    setNote("");
    setNewDate("");
  }, [open, facts.expected_start_on, facts.expected_start_status]);

  const name = facts.agent_name?.trim() || "this hire";
  const text = expectedStartText(facts);
  const outcome = currentStartOutcome(facts as OnboardingFacts);
  const dateArrived = !!facts.expected_start_on && facts.expected_start_on <= phoenixToday();

  const done = async () => {
    await qc.invalidateQueries({ queryKey: ONBOARDING_FACTS_KEY });
  };

  const save = async () => {
    if (!status) { toast.error("Pick a start status."); return; }
    if ((status === "confirmed" || status === "likely") && !date) { toast.error("A confirmed or likely start needs a date."); return; }
    setBusy(true);
    const { error } = await supabase.rpc("set_expected_start" as never, {
      p_agent_id: facts.agent_id,
      p_expected_start_on: date || null,
      p_status: status,
      p_note: note.trim() || null,
    } as never);
    setBusy(false);
    if (error) { toast.error(`${name}: ${error.message}`); return; }
    toast.success(`${name}: expected start ${EXPECTED_START_LABEL[status].toLowerCase()}${date ? ` for ${date}` : ""}.`);
    setOpen(false);
    await done();
  };

  const recordOutcome = async (o: StartOutcome) => {
    setBusy(true);
    const { error } = await supabase.rpc("record_start_outcome" as never, {
      p_agent_id: facts.agent_id,
      p_outcome: o,
      p_new_start_on: o === "rescheduled" && newDate ? newDate : null,
      p_note: note.trim() || null,
    } as never);
    setBusy(false);
    if (error) { toast.error(`${name}: ${error.message}`); return; }
    toast.success(
      o === "rescheduled"
        ? `${name}: rescheduled${newDate ? ` to ${newDate} (not yet confirmed)` : "; new date not set"}.`
        : `${name}: ${START_OUTCOME_LABEL[o].toLowerCase()} recorded. Employment status unchanged.`,
    );
    setOpen(false);
    await done();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className={cn("h-7 gap-1 px-2 text-xs", !text && "text-muted-foreground")}
          aria-label={`Expected start for ${name}`}
        >
          <CalendarClock className="h-3.5 w-3.5" />
          {compact ? (text ? text.split(" · ")[0] : "Set start") : (text ?? "Set expected start")}
          {outcome && <span className="text-muted-foreground"> · {START_OUTCOME_LABEL[outcome]}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 space-y-3">
        <div>
          <p className="text-sm font-semibold">Expected start</p>
          <p className="text-xs text-muted-foreground">Their answer about a start date. It never changes employment status.</p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            aria-label="Expected start date"
            className="h-8 text-xs"
          />
          <Select value={status} onValueChange={(v) => setStatus(v as ExpectedStartStatus)}>
            <SelectTrigger className="h-8 text-xs" aria-label="Expected start status"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              {EXPECTED_START_STATUSES.map((s) => (
                <SelectItem key={s} value={s} className="text-xs">{EXPECTED_START_LABEL[s]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" aria-label="Note" className="h-8 text-xs" maxLength={280} />
        <Button size="sm" className="h-8 w-full" disabled={busy} onClick={() => void save()}>
          {busy ? "Saving…" : "Save expected start"}
        </Button>

        {facts.expected_start_on && (
          <div className="space-y-2 border-t border-border pt-3">
            <p className="text-sm font-semibold">What happened on {facts.expected_start_on}</p>
            {outcome ? (
              <p className="text-xs text-muted-foreground">Recorded: {START_OUTCOME_LABEL[outcome]}.</p>
            ) : !dateArrived ? (
              <p className="text-xs text-muted-foreground">Attended or no-show can be recorded once the date arrives. A reschedule can be recorded now.</p>
            ) : null}
            <div className="flex flex-wrap gap-1.5">
              <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy || !dateArrived} onClick={() => void recordOutcome("attended")}>Attended</Button>
              <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy || !dateArrived} onClick={() => void recordOutcome("no_show")}>No-show</Button>
            </div>
            <div className="flex items-center gap-1.5">
              <Input
                type="date"
                value={newDate}
                onChange={(e) => setNewDate(e.target.value)}
                aria-label="New start date for the reschedule"
                className="h-7 flex-1 text-xs"
              />
              <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy} onClick={() => void recordOutcome("rescheduled")}>Rescheduled</Button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
