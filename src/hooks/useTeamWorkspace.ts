import { useCallback, useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import type { RosterRow } from "@/lib/teamRoster";

/**
 * What the My Team page shares between the roster rows and the person drawer: who may see contracting, and which
 * person is open.
 *
 * The open person lives in the URL (?person=<id>), so a refresh, a shared link or the browser back button keeps the
 * drawer on the same person without anything else on the page changing: the roster's search, filters and scroll
 * position are page state and are untouched by opening or closing it.
 */
export function useTeamWorkspace(rows: RosterRow[], rowsReady: boolean) {
  const { isAdmin, isManager, isVaManager, isVa } = useAuth();
  const contractingEnabled = isAdmin || isManager || isVaManager || isVa;

  const rowById = useMemo(() => new Map(rows.map((r) => [r.agent_id, r] as const)), [rows]);

  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get("person");
  const row = selectedId ? rowById.get(selectedId) : undefined;

  const openPerson = useCallback((id: string) => {
    setSearchParams((prev) => { const n = new URLSearchParams(prev); n.set("person", id); return n; }, { replace: true });
  }, [setSearchParams]);
  const closePerson = useCallback(() => {
    setSearchParams((prev) => { const n = new URLSearchParams(prev); n.delete("person"); return n; }, { replace: true });
  }, [setSearchParams]);

  // A stale or mistyped ?person= must not leave an empty drawer open: once the roster has settled, drop it.
  useEffect(() => {
    if (selectedId && rowsReady && !row) closePerson();
  }, [selectedId, rowsReady, row, closePerson]);

  return { contractingEnabled, selectedId, row, openPerson, closePerson };
}
