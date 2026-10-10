import { useCallback, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useRealtimeTable } from "@/shared/realtime/useRealtimeTable";
import { parseAttendanceDay, saveBulk, saveMark, statusLabel, type AttendanceDay, type AttendancePerson, type MarkStatus } from "@/lib/teamStage";

export const attendanceKey = (date: string) => ["team-attendance", date] as const;

async function fetchDay(date: string): Promise<AttendanceDay> {
  const { data, error } = await supabase.rpc("team_attendance_day", { p_date: date });
  if (error) throw new Error(error.message);
  return parseAttendanceDay(data);
}

function recount(d: AttendanceDay): AttendanceDay {
  const s = { ...d.summary, present: 0, absent: 0, excused: 0, unmarked: 0 };
  for (const p of d.people) {
    if (p.status === "present") s.present += 1; else if (p.status === "absent") s.absent += 1; else if (p.status === "excused") s.excused += 1;
    else if (p.expected === "yes") s.unmarked += 1;
  }
  return { ...d, summary: s };
}

/** One day of attendance: the read, one-tap marks with Undo, corrections, and the explicit-selection bulk mark. */
export function useTeamAttendance(date: string, enabled = true) {
  const { isAdmin, isManager, isVaManager, isVa } = useAuth();
  const canRead = isAdmin || isManager || isVaManager || isVa;
  const canEdit = isAdmin || isManager;
  const qc = useQueryClient();
  const key = attendanceKey(date);
  const query = useQuery({ queryKey: key, queryFn: () => fetchDay(date), enabled: enabled && canRead && !!date, staleTime: 15_000, retry: 1 });
  useRealtimeTable({ table: "agent_attendance_events", event: "INSERT", channelSuffix: "team-attendance", coalesceMs: 750, enabled: enabled && canRead }, () => {
    void qc.invalidateQueries({ queryKey: ["team-attendance"] });
  });

  const inFlight = useRef<Set<string>>(new Set());
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const begin = (k: string) => { if (inFlight.current.has(k)) return false; inFlight.current.add(k); setPending(new Set(inFlight.current)); return true; };
  const end = (k: string) => { inFlight.current.delete(k); setPending(new Set(inFlight.current)); };
  const patch = useCallback((id: string, fn: (p: AttendancePerson) => AttendancePerson) => {
    qc.setQueryData<AttendanceDay>(key, (old) => old ? recount({ ...old, people: old.people.map((p) => p.agent_id === id ? fn(p) : p) }) : old);
  }, [qc, key]);
  const nowOf = useCallback((id: string) => qc.getQueryData<AttendanceDay>(key)?.people.find((p) => p.agent_id === id), [qc, key]);

  const mark = useCallback(async (agentId: string, status: MarkStatus, opts?: { undo?: boolean; note?: string }): Promise<boolean> => {
    if (!canEdit) return false;
    const k = `${agentId}`;
    const before = nowOf(agentId);
    if (!before || !begin(k)) return false;
    const was = before.status;
    const name = before.display_name;
    patch(agentId, (p) => ({ ...p, status, marked_by_name: status === "unmarked" ? null : "you", marked_at: status === "unmarked" ? null : new Date().toISOString(), note: opts?.note ?? (status === "unmarked" ? null : p.note) }));
    try {
      const r = await saveMark(agentId, date, status, was, opts?.note);
      if (r.ok) {
        if (!opts?.undo) toast.success(`${name}: ${statusLabel(status)}`, { action: { label: "Undo", onClick: () => { void mark(agentId, was, { undo: true }); } } });
        return true;
      }
      if (r.conflict) { toast.message(`${name}'s attendance was just changed somewhere else. Showing the saved mark.`); patch(agentId, (p) => ({ ...p, status: r.status })); }
      else { patch(agentId, (p) => ({ ...p, status: was })); toast.error(`${name}'s mark did not save. It is back to ${statusLabel(was)}.${r.error ? ` ${r.error}` : ""}`, { action: { label: "Retry", onClick: () => { void mark(agentId, status, { note: opts?.note }); } } }); }
      return false;
    } catch {
      patch(agentId, (p) => ({ ...p, status: was, marked_by_name: before.marked_by_name, marked_at: before.marked_at, note: before.note }));
      toast.error(`${name}'s attendance did not save. The previous mark is restored; try again.`);
      return false;
    } finally { end(k); void qc.invalidateQueries({ queryKey: key }); }
  }, [canEdit, date, key, nowOf, patch, qc]);

  const bulk = useCallback(async (agentIds: string[], status: Exclude<MarkStatus, "unmarked">): Promise<{ ok: boolean; applied: number; skipped: number; denied: number; error: string | null }> => {
    if (!canEdit) return { ok: false, applied: 0, skipped: 0, denied: 0, error: "View only." };
    if (!begin("bulk")) return { ok: false, applied: 0, skipped: 0, denied: 0, error: "Already saving." };
    try {
      const r = await saveBulk(date, agentIds, status);
      if (r.ok) toast.success(`${r.applied} marked ${statusLabel(status)}${r.skipped ? `, ${r.skipped} already marked and left alone` : ""}${r.denied ? `, ${r.denied} not yours to mark` : ""}.`);
      else toast.error(`The bulk mark did not save.${r.error ? ` ${r.error}` : ""}`);
      return r;
    } catch {
      toast.error("Attendance did not save. Your selection is still here; try again.");
      return { ok: false, applied: 0, skipped: 0, denied: 0, error: "Attendance did not save." };
    } finally { end("bulk"); void qc.invalidateQueries({ queryKey: key }); }
  }, [canEdit, date, key, qc]);

  return { query, day: query.data ?? null, canRead, canEdit, mark, bulk, isPending: (id: string) => pending.has(id) || pending.has("bulk") };
}
