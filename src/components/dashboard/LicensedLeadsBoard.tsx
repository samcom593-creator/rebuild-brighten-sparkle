/**
 * LicensedLeadsBoard (MP-MORNING-LEADS, 2026-11-23): does every licensed agent hold leads?
 *
 * Sam: "make sure every person licensed [has leads] for tomorrow morning ... everyone must start writing."
 *
 * Contract:
 *   - source: owner_licensed_leads_board() (definer, admin only): one row per active licensed agent.
 *   - the grant itself is automatic (fn_grant_morning_leads, hourly 06:45 to 16:45 Phoenix, Mon to Sat):
 *     everyone eligible is topped up to 25 unworked leads matched to their state.
 *   - this card shows the count covered and ONLY the people waiting on something a person supplies:
 *     a license state (saved here, leads granted on the save) or an interview (marked here, same).
 *   - rules and wording: src/lib/licensedLeadsBoard.ts.
 */
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Phone, Target } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/queryState";
import { formatTimeAgo } from "@/lib/dateUtils";
import { formatPhoneDisplay, isRealUsNumber, startPhoneCall } from "@/lib/phone";
import { StateEntry } from "@/components/dashboard/MondayRollCall";
import {
  LICENSED_LEADS_QUERY_KEY,
  leadsReplyLine,
  summarizeBoard,
  waitingLabel,
  waitingRows,
  type LeadsReply,
  type LicensedLeadsPayload,
  type LicensedLeadsRow,
} from "@/lib/licensedLeadsBoard";

type RpcFn<T> = (fn: string, args?: Record<string, unknown>) => Promise<{ data: T | null; error: { message: string } | null }>;

const FIRST_SHOWN = 6;

function WaitingRow({
  row, busy, onStates, onInterviewed,
}: {
  row: LicensedLeadsRow;
  busy: boolean;
  onStates: (states: string[]) => void;
  onInterviewed: () => void;
}) {
  const canDial = isRealUsNumber(row.phone);
  return (
    <li className="rounded-xl border border-border bg-background/40 p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <span className="block text-[15px] font-semibold text-foreground">{row.name}</span>
          <span className="block text-[13px] leading-5 text-muted-foreground">
            {waitingLabel(row.reason)} · {row.last_sign_in_at ? `signed in ${formatTimeAgo(row.last_sign_in_at)}` : "never signed in"}
          </span>
        </div>
        <Button
          size="sm"
          variant="secondary"
          className="shrink-0 self-start sm:self-auto"
          disabled={!canDial}
          onClick={() => { if (!startPhoneCall(row.phone)) toast.error("That number cannot be dialed"); }}
          aria-label={canDial ? `Call ${row.name}` : `No usable phone on file for ${row.name}`}
        >
          <Phone className="mr-1.5 h-4 w-4" aria-hidden="true" />
          {canDial ? formatPhoneDisplay(row.phone) : "No phone"}
        </Button>
      </div>
      {row.reason === "license_state_unknown" && (
        <div className="mt-2"><StateEntry row={row} busy={busy} onSave={onStates} /></div>
      )}
      {row.reason === "not_interviewed_yet" && (
        <Button size="sm" variant="outline" className="mt-2" disabled={busy} onClick={onInterviewed}>
          Interviewed
        </Button>
      )}
    </li>
  );
}

export function LicensedLeadsBoard() {
  const queryClient = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const query = useQuery({
    queryKey: LICENSED_LEADS_QUERY_KEY,
    queryFn: async (): Promise<LicensedLeadsPayload> => {
      const { data, error } = await (supabase.rpc as unknown as RpcFn<LicensedLeadsPayload>)("owner_licensed_leads_board");
      if (error) throw new Error(error.message);
      return data ?? { enabled: false, rows: [] };
    },
    staleTime: 60_000,
  });

  const rows = useMemo(() => query.data?.rows ?? [], [query.data]);
  const summary = useMemo(() => summarizeBoard(rows), [rows]);
  const waiting = useMemo(() => waitingRows(rows), [rows]);
  const shown = showAll ? waiting : waiting.slice(0, FIRST_SHOWN);

  const write = async (agentId: string, fn: string, args: Record<string, unknown>, done: string) => {
    setBusyId(agentId);
    try {
      const { data, error } = await (supabase.rpc as unknown as RpcFn<{ ok: boolean; leads?: LeadsReply | null }>)(fn, args);
      if (error) throw new Error(error.message);
      toast.success(`${done}${leadsReplyLine(data?.leads)}`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: LICENSED_LEADS_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: ["owner-monday-rollcall"] }),
      ]);
    } catch (err) {
      toast.error(errorMessage(err, "That did not save. Try again."));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section aria-labelledby="licensed-leads-title" className="min-w-0 rounded-2xl border border-border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
            <Target className="h-4 w-4" aria-hidden="true" />
            Leads for every licensed agent
          </p>
          <h2 id="licensed-leads-title" className="text-lg font-semibold text-foreground">
            {query.isLoading ? "Checking who holds leads" : `${summary.covered} of ${summary.total - summary.accessOff} hold leads`}
          </h2>
          <p className="text-[13px] leading-5 text-muted-foreground">
            Everyone eligible is kept at 25 unworked leads matched to their state, refilled hourly through the day.
            {query.data && !query.data.enabled ? " The automatic refill is switched off." : ""}
          </p>
        </div>
        {rows.length > 0 && (
          <dl className="flex shrink-0 gap-4 text-right">
            <div><dt className="text-[12px] text-muted-foreground">Need a state</dt><dd className="text-xl font-semibold tabular-nums text-foreground">{summary.needState}</dd></div>
            <div><dt className="text-[12px] text-muted-foreground">Need an interview</dt><dd className="text-xl font-semibold tabular-nums text-foreground">{summary.needInterview}</dd></div>
          </dl>
        )}
      </div>

      {query.isLoading && <div className="mt-4"><Skeleton className="h-20 w-full" /></div>}
      {query.isError && (
        <p role="alert" className="mt-4 text-sm text-rose-300">
          The leads board could not load: {errorMessage(query.error, "unknown error")}
        </p>
      )}

      {!query.isLoading && !query.isError && waiting.length === 0 && rows.length > 0 && (
        <p className="mt-3 text-sm text-foreground">Nobody is waiting on you. Every licensed agent with access holds leads.</p>
      )}

      {waiting.length > 0 && (
        <>
          <p className="mt-3 text-[13px] leading-5 text-foreground">
            {waiting.length} waiting on one thing from you. Save it here and their leads are granted on the spot.
            {summary.accessOff > 0 ? ` ${summary.accessOff} more have access switched off and get none.` : ""}
          </p>
          <ul className="mt-3 space-y-2">
            {shown.map((row) => (
              <WaitingRow
                key={row.agent_id}
                row={row}
                busy={busyId === row.agent_id}
                onStates={(states) => write(
                  row.agent_id,
                  "owner_monday_rollcall_set_states",
                  { p_agent_id: row.agent_id, p_states: states },
                  `${row.name}: ${states.join(", ")} saved.`,
                )}
                onInterviewed={() => write(
                  row.agent_id,
                  "owner_monday_rollcall_mark",
                  { p_agent_id: row.agent_id, p_mark: "interviewed" },
                  `${row.name}: marked interviewed.`,
                )}
              />
            ))}
          </ul>
          {waiting.length > FIRST_SHOWN && (
            <Button variant="ghost" size="sm" className="mt-3" onClick={() => setShowAll((v) => !v)}>
              {showAll ? "Show fewer" : `Show all ${waiting.length}`}
            </Button>
          )}
        </>
      )}
    </section>
  );
}
