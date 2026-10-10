import { useCallback, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useRealtimeTable } from "@/shared/realtime/useRealtimeTable";
import { parseTeamFacts, saveStage, saveWorkdays, stageLabel, workdaysSummary, type PersonFacts, type StageKey, type TeamFacts } from "@/lib/teamStage";

export const TEAM_FACTS_KEY = ["team-facts"] as const;

async function fetchFacts(): Promise<TeamFacts> {
  const { data, error } = await supabase.rpc("team_people_facts");
  if (error) throw new Error(error.message);
  return parseTeamFacts(data);
}

/**
 * Stage, work commitment and access facts for every person on the team, with the two writers. Admins and managers write;
 * everyone else who may read gets read-only controls. Writes are immediate with an Undo; a write that does not land puts
 * the previous value back and says so.
 */
export function useTeamFacts(enabled = true) {
  const { isAdmin, isManager, isVaManager, isVa } = useAuth();
  const canRead = isAdmin || isManager || isVaManager || isVa;
  const canEdit = isAdmin || isManager;
  const qc = useQueryClient();
  const query = useQuery({ queryKey: TEAM_FACTS_KEY, queryFn: fetchFacts, enabled: enabled && canRead, staleTime: 30_000, retry: 1 });
  useRealtimeTable({ table: "agent_stage_events", event: "INSERT", channelSuffix: "team-facts", coalesceMs: 750, enabled: enabled && canRead }, () => {
    void qc.invalidateQueries({ queryKey: TEAM_FACTS_KEY });
  });

  const inFlight = useRef<Set<string>>(new Set());
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const begin = (k: string) => { if (inFlight.current.has(k)) return false; inFlight.current.add(k); setPending(new Set(inFlight.current)); return true; };
  const end = (k: string) => { inFlight.current.delete(k); setPending(new Set(inFlight.current)); };
  const patch = useCallback((id: string, fn: (p: PersonFacts) => PersonFacts) => {
    qc.setQueryData<TeamFacts>(TEAM_FACTS_KEY, (old) => old ? { ...old, people: old.people.map((p) => p.agent_id === id ? fn(p) : p) } : old);
  }, [qc]);
  const nowOf = useCallback((id: string) => qc.getQueryData<TeamFacts>(TEAM_FACTS_KEY)?.people.find((p) => p.agent_id === id), [qc]);

  const setStage = useCallback(async (agentId: string, name: string, stage: StageKey, opts?: { undo?: boolean }): Promise<boolean> => {
    if (!canEdit) return false;
    const k = `${agentId}:stage`;
    const before = nowOf(agentId);
    if (!before || !begin(k)) return false;
    const was = before.stage;
    patch(agentId, (p) => ({ ...p, stage, stage_label: stageLabel(stage), stage_source: "staff" }));
    try {
      const r = await saveStage(agentId, stage, was);
      if (r.ok) {
        if (!opts?.undo && was) toast.success(`${name}: ${stageLabel(stage)}`, { action: { label: "Undo", onClick: () => { void setStage(agentId, name, was, { undo: true }); } } });
        else if (!opts?.undo) toast.success(`${name}: ${stageLabel(stage)}`);
        return true;
      }
      if (r.conflict) { toast.message(`${name}'s stage was just changed somewhere else. Showing the saved value.`); patch(agentId, (p) => ({ ...p, stage: r.stage, stage_label: r.stage ? stageLabel(r.stage) : null })); }
      else { patch(agentId, (p) => ({ ...p, stage: was, stage_label: was ? stageLabel(was) : null })); toast.error(`${name}'s stage did not save. It is back to ${stageLabel(was)}.${r.error ? ` ${r.error}` : ""}`, { action: { label: "Retry", onClick: () => { void setStage(agentId, name, stage); } } }); }
      return false;
    } catch {
      patch(agentId, (p) => ({ ...p, stage: was, stage_label: was ? stageLabel(was) : null, stage_source: before.stage_source }));
      toast.error(`${name}'s stage did not save. The previous stage is restored; try again.`);
      return false;
    } finally { end(k); if (inFlight.current.size === 0) void qc.invalidateQueries({ queryKey: TEAM_FACTS_KEY }); }
  }, [canEdit, nowOf, patch, qc]);

  const setWorkdays = useCallback(async (agentId: string, name: string, weekdays: number[], effectiveFrom?: string, opts?: { undo?: boolean }): Promise<boolean> => {
    if (!canEdit) return false;
    const k = `${agentId}:workdays`;
    const before = nowOf(agentId);
    if (!before || !begin(k)) return false;
    const was = before.schedule_set ? before.weekdays ?? [] : null;
    const immediate = !effectiveFrom;
    if (immediate) patch(agentId, (p) => ({ ...p, schedule_set: true, weekdays }));
    try {
      const r = await saveWorkdays(agentId, weekdays, was, effectiveFrom);
      if (r.ok) {
        const text = immediate ? `${name}: ${workdaysSummary(weekdays)}` : `${name}: ${workdaysSummary(weekdays)} from ${effectiveFrom}`;
        if (!opts?.undo && immediate && was !== null) toast.success(text, { action: { label: "Undo", onClick: () => { void setWorkdays(agentId, name, was, undefined, { undo: true }); } } });
        else if (!opts?.undo) toast.success(text);
        return true;
      }
      if (r.conflict) { toast.message(`${name}'s schedule was just changed somewhere else. Showing the saved value.`); patch(agentId, (p) => ({ ...p, schedule_set: r.weekdays !== null, weekdays: r.weekdays })); }
      else { if (immediate) patch(agentId, (p) => ({ ...p, schedule_set: was !== null, weekdays: was })); toast.error(`${name}'s schedule did not save. It is back to ${workdaysSummary(was)}.${r.error ? ` ${r.error}` : ""}`, { action: { label: "Retry", onClick: () => { void setWorkdays(agentId, name, weekdays, effectiveFrom); } } }); }
      return false;
    } catch {
      if (immediate) patch(agentId, (p) => ({ ...p, schedule_set: was !== null, weekdays: was }));
      toast.error(`${name}'s schedule did not save. The previous commitment is restored; try again.`);
      return false;
    } finally { end(k); if (inFlight.current.size === 0) void qc.invalidateQueries({ queryKey: TEAM_FACTS_KEY }); }
  }, [canEdit, nowOf, patch, qc]);

  return { query, facts: query.data ?? null, canRead, canEdit, setStage, setWorkdays, isPending: (id: string, what: string) => pending.has(`${id}:${what}`) };
}
