/**
 * MondayRollCall (MP-MONDAY-ROLLCALL, 2026-11-22): the owner's call list for the Monday meeting.
 *
 * Sam: "track who's supposed to be there Monday, based on the hires, and make a very clear list on my
 * first screen I can call ... for all these hired agents."
 *
 * Contract:
 *   - source: owner_monday_rollcall() (definer, admin only). One row per hire of the last 45 days.
 *   - writes: owner_monday_rollcall_mark() (result of the call), owner_monday_rollcall_set_states()
 *             (the license state a hire link never asked for; the hourly starter-pack grant reads it).
 *   - order and wording: src/lib/mondayRollCall.ts.
 * The list is people, not a count: every row has the number to dial and one tap to record the result.
 */
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck, MessageSquare, Phone } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { errorMessage } from "@/lib/queryState";
import { formatPhoneDisplay, startPhoneCall, startSmsThread } from "@/lib/phone";
import { contractingLink, smsBody } from "@/lib/contractingRequests";
import {
  BEFORE_MARKS,
  DAY_OF_MARKS,
  MARK_LABEL,
  hiredLabel,
  interviewLine,
  leadsLine,
  linkLine,
  mondayLabel,
  needsList,
  notInterviewed,
  phoneUsable,
  parseStates,
  sortRollCall,
  summarize,
  type RollCallMark,
  type RollCallPayload,
  type RollCallRow,
} from "@/lib/mondayRollCall";
import { LICENSED_LEADS_QUERY_KEY, leadsReplyLine, type LeadsReply } from "@/lib/licensedLeadsBoard";

type RpcFn<T> = (fn: string, args?: Record<string, unknown>) => Promise<{ data: T | null; error: { message: string } | null }>;

const QUERY_KEY = ["owner-monday-rollcall"] as const;
const FIRST_SHOWN = 12;

const MARK_TONE: Record<RollCallMark, string> = {
  confirmed: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  showed: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  no_answer: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  texted: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  cant_make_it: "border-rose-500/40 bg-rose-500/10 text-rose-300",
  no_show: "border-rose-500/40 bg-rose-500/10 text-rose-300",
};

export function StateEntry({ row, busy, onSave }: { row: Pick<RollCallRow, "name" | "phone_state_hint">; busy: boolean; onSave: (states: string[]) => void }) {
  const [value, setValue] = useState("");
  const states = parseStates(value);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        aria-label={`License state for ${row.name}`}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="State, e.g. AZ"
        className="h-9 w-32 text-sm uppercase"
        maxLength={24}
      />
      <Button size="sm" variant="secondary" disabled={busy || states.length === 0} onClick={() => onSave(states)}>
        Save state
      </Button>
      {row.phone_state_hint && states.length === 0 && (
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => onSave([row.phone_state_hint as string])}>
          Use {row.phone_state_hint} (their area code)
        </Button>
      )}
    </div>
  );
}

function PersonRow({
  row, isToday, busy, onMark, onStates,
}: {
  row: RollCallRow;
  isToday: boolean;
  busy: boolean;
  onMark: (mark: RollCallMark | "interviewed") => void;
  onStates: (states: string[]) => void;
}) {
  const needs = needsList(row);
  const interview = interviewLine(row);
  const marks = isToday ? [...DAY_OF_MARKS, ...BEFORE_MARKS] : BEFORE_MARKS;
  const needsState = row.licensed && !(row.license_states && row.license_states.length);
  const canDial = phoneUsable(row.phone);
  const link = linkLine(row);
  return (
    <li className="rounded-xl border border-border bg-background/40 p-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[15px] font-semibold text-foreground">{row.name}</span>
            {row.mark && (
              <span className={cn("rounded-full border px-2 py-0.5 text-[12px] font-semibold", MARK_TONE[row.mark])}>
                {MARK_LABEL[row.mark]}
              </span>
            )}
          </div>
          <p className="text-[13px] leading-5 text-muted-foreground">
            {hiredLabel(row)}
            {row.license_states && row.license_states.length ? ` · ${row.license_states.join(", ")}` : ""}
            {row.manager_name ? ` · under ${row.manager_name}` : ""}
          </p>
          {interview && (
            <p className={cn("text-[13px] font-semibold leading-5", row.interview_state === "missed" ? "text-rose-300" : "text-amber-300")}>
              {interview}
            </p>
          )}
          {link && <p className="text-[13px] font-semibold leading-5 text-foreground">{link}</p>}
          {needs.length > 0 && <p className="text-[13px] leading-5 text-foreground">Needs: {needs.join(" · ")}</p>}
          <p className="text-[13px] leading-5 text-muted-foreground">{leadsLine(row)}</p>
          {!canDial && row.email && <p className="break-all text-[13px] leading-5 text-foreground">Email: {row.email}</p>}
          {row.mark_note && <p className="text-[13px] leading-5 text-muted-foreground">Note: {row.mark_note}</p>}
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            size="sm"
            disabled={!canDial}
            onClick={() => { if (!startPhoneCall(row.phone)) toast.error("That number cannot be dialed"); }}
            aria-label={canDial ? `Call ${row.name}` : `No usable phone on file for ${row.name}`}
          >
            <Phone className="mr-1.5 h-4 w-4" aria-hidden="true" />
            {canDial ? formatPhoneDisplay(row.phone) : row.phone ? "Bad number" : "No phone"}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={!canDial}
            onClick={() => { if (!startSmsThread(row.phone)) toast.error("That number cannot be texted"); }}
            aria-label={`Text ${row.name}`}
          >
            <MessageSquare className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {marks.map((mark) => (
          <Button
            key={mark}
            size="sm"
            variant={row.mark === mark ? "default" : "outline"}
            disabled={busy}
            aria-pressed={row.mark === mark}
            onClick={() => onMark(mark)}
          >
            {MARK_LABEL[mark]}
          </Button>
        ))}
        {notInterviewed(row) && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => onMark("interviewed")}>
            Interviewed
          </Button>
        )}
        {link && row.licensed && canDial && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              // Opens the owner's own messages app with the contracting link written out; nothing is sent for him.
              if (!startSmsThread(row.phone, smsBody(row.name, row.contracting_link ?? contractingLink()))) toast.error("That number cannot be texted");
            }}
          >
            Text the link
          </Button>
        )}
      </div>
      {needsState && <div className="mt-3"><StateEntry row={row} busy={busy} onSave={onStates} /></div>}
    </li>
  );
}

export function MondayRollCall() {
  const queryClient = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async (): Promise<RollCallPayload> => {
      const { data, error } = await (supabase.rpc as unknown as RpcFn<RollCallPayload>)("owner_monday_rollcall");
      if (error) throw new Error(error.message);
      return data ?? { monday: "", is_today: false, rows: [] };
    },
    staleTime: 60_000,
  });

  const rows = useMemo(() => sortRollCall(query.data?.rows ?? []), [query.data]);
  const summary = useMemo(() => summarize(rows), [rows]);
  const shown = showAll ? rows : rows.slice(0, FIRST_SHOWN);

  const write = async (agentId: string, fn: string, args: Record<string, unknown>, done: string) => {
    setBusyId(agentId);
    try {
      const { data, error } = await (supabase.rpc as unknown as RpcFn<{ ok: boolean; leads?: LeadsReply | null }>)(fn, args);
      if (error) throw new Error(error.message);
      toast.success(`${done}${leadsReplyLine(data?.leads)}`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: LICENSED_LEADS_QUERY_KEY }),
      ]);
    } catch (err) {
      toast.error(errorMessage(err, "That did not save. Try again."));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section aria-labelledby="monday-rollcall-title" className="min-w-0 rounded-2xl border border-border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
            <CalendarCheck className="h-4 w-4" aria-hidden="true" />
            {query.data?.is_today ? "Today's meeting" : "Monday meeting"}
          </p>
          <h2 id="monday-rollcall-title" className="text-lg font-semibold text-foreground">
            {query.data?.monday ? `Call list for ${mondayLabel(query.data.monday)}` : "Call list for Monday"}
          </h2>
          <p className="text-[13px] leading-5 text-muted-foreground">
            People who were sent the link and are not producing yet come first, then every hire of the last 45 days.
            Call each one, then tap the result.
          </p>
        </div>
        {rows.length > 0 && (
          <dl className="flex shrink-0 gap-4 text-right">
            <div><dt className="text-[12px] text-muted-foreground">To call</dt><dd className="text-xl font-semibold tabular-nums text-foreground">{summary.toCall}</dd></div>
            <div><dt className="text-[12px] text-muted-foreground">Confirmed</dt><dd className="text-xl font-semibold tabular-nums text-foreground">{summary.confirmed}</dd></div>
            {query.data?.is_today && (
              <div><dt className="text-[12px] text-muted-foreground">Showed</dt><dd className="text-xl font-semibold tabular-nums text-foreground">{summary.showed}</dd></div>
            )}
          </dl>
        )}
      </div>

      {query.isLoading && <div className="mt-4 space-y-2"><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /></div>}
      {query.isError && (
        <p role="alert" className="mt-4 text-sm text-rose-300">
          The call list could not load: {errorMessage(query.error, "unknown error")}
        </p>
      )}
      {!query.isLoading && !query.isError && rows.length === 0 && (
        <p className="mt-4 text-sm text-muted-foreground">Nobody to call: no recent hires and nobody waiting on a link.</p>
      )}

      {rows.length > 0 && (
        <>
          {(summary.linkNoProduction > 0 || summary.notInterviewed > 0 || summary.noLeadsYet > 0) && (
            <p className="mt-3 text-[13px] leading-5 text-foreground">
              {summary.linkNoProduction > 0 && `${summary.linkNoProduction} were sent the link and have no production. `}
              {summary.notInterviewed > 0 && `${summary.notInterviewed} not interviewed yet. `}
              {summary.noLeadsYet > 0 && `${summary.noLeadsYet} licensed with no leads in hand.`}
            </p>
          )}
          <ul className="mt-3 space-y-2">
            {shown.map((row) => (
              <PersonRow
                key={row.agent_id}
                row={row}
                isToday={Boolean(query.data?.is_today)}
                busy={busyId === row.agent_id}
                onMark={(mark) => write(
                  row.agent_id,
                  "owner_monday_rollcall_mark",
                  { p_agent_id: row.agent_id, p_mark: mark },
                  mark === "interviewed" ? `${row.name}: marked interviewed` : `${row.name}: ${MARK_LABEL[mark]}`,
                )}
                onStates={(states) => write(
                  row.agent_id,
                  "owner_monday_rollcall_set_states",
                  { p_agent_id: row.agent_id, p_states: states },
                  `${row.name}: ${states.join(", ")} saved.`,
                )}
              />
            ))}
          </ul>
          {rows.length > FIRST_SHOWN && (
            <Button variant="ghost" size="sm" className="mt-3" onClick={() => setShowAll((v) => !v)}>
              {showAll ? "Show fewer" : `Show all ${rows.length}`}
            </Button>
          )}
        </>
      )}
    </section>
  );
}
