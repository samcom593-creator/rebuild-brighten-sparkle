import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useRealtimeTable } from "@/shared/realtime/useRealtimeTable";
import { useCheckoffToggle, useTeamContracting } from "@/lib/teamContracting";
import type { ContractingReadState } from "@/components/team/ContractingBadges";
import type { RosterRow } from "@/lib/teamRoster";

/**
 * Everything the My Team page shares between the Priority 1 section, the roster rows and the person drawer: the one
 * contracting read, the audited checkoff toggle, who may tick, how to reach a person, and which person is open.
 *
 * The open person lives in the URL (?person=<id>), so a refresh, a shared link or the browser back button keeps the
 * drawer on the same person without anything else on the page changing: the roster's search, filters and scroll
 * position are page state and are untouched by opening or closing it.
 */
export function useTeamWorkspace(rows: RosterRow[], rowsReady: boolean) {
  const { isAdmin, isManager, isVaManager, isVa } = useAuth();
  const queryClient = useQueryClient();
  const contractingEnabled = isAdmin || isManager || isVaManager || isVa;
  const canTick = isAdmin || isManager;
  const tc = useTeamContracting(contractingEnabled);
  const checkoff = useCheckoffToggle(tc.queryKey);

  // A tick made in another session arrives as an INSERT on the append-only events table (scoped by row security).
  useRealtimeTable({ table: "agent_contract_checkoff_events", event: "INSERT", channelSuffix: "team-contracting", coalesceMs: 750, enabled: contractingEnabled }, () => {
    void queryClient.invalidateQueries({ queryKey: tc.queryKey });
  });

  const rowById = useMemo(() => new Map(rows.map((r) => [r.agent_id, r] as const)), [rows]);
  const contactFor = useCallback((id: string) => {
    const r = rowById.get(id) ?? (tc.byAgent.get(id)?.alias_ids ?? []).map((a) => rowById.get(a)).find(Boolean);
    return { phone: r?.phone ?? null, email: r?.email ?? null };
  }, [rowById, tc.byAgent]);

  const read: ContractingReadState = tc.isLoading ? "loading" : tc.isError || !tc.data ? "error" : "ok";

  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get("person");
  const [scrollTo, setScrollTo] = useState<"followup" | null>(null);
  const person = selectedId ? tc.byAgent.get(selectedId) : undefined;
  const row = selectedId ? rowById.get(selectedId) ?? (person ? rowById.get(person.agent_id) : undefined) : undefined;

  const openPerson = useCallback((id: string, section?: "followup") => {
    setScrollTo(section ?? null);
    setSearchParams((prev) => { const n = new URLSearchParams(prev); n.set("person", id); return n; }, { replace: true });
  }, [setSearchParams]);
  const closePerson = useCallback(() => {
    setScrollTo(null);
    setSearchParams((prev) => { const n = new URLSearchParams(prev); n.delete("person"); return n; }, { replace: true });
  }, [setSearchParams]);

  // A stale or mistyped ?person= must not leave an empty drawer open: once both reads have settled, drop it.
  const settled = rowsReady && !tc.isLoading;
  useEffect(() => {
    if (selectedId && settled && !person && !row) closePerson();
  }, [selectedId, settled, person, row, closePerson]);

  return { tc, checkoff, canTick, contractingEnabled, contactFor, read, selectedId, person, row, openPerson, closePerson, scrollTo };
}
