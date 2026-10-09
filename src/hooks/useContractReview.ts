import { useCallback, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useRealtimeTable } from "@/shared/realtime/useRealtimeTable";
import {
  parseReviewRoster, saveLevel, saveMark, saveProfileForAgent, withLevel, withMark,
  type IntakeValues, type MarkInfo, type ProfileResult, type ReviewAgent, type ReviewCarrier, type ReviewRoster,
} from "@/lib/contractReview";

export const CONTRACT_REVIEW_KEY = ["contract-review-roster"] as const;

async function fetchRoster(): Promise<ReviewRoster> {
  const { data, error } = await supabase.rpc("contract_review_roster");
  if (error) throw new Error(error.message);
  return parseReviewRoster(data);
}

/**
 * The one contracting review, shared by My Team and the Contracts page: both read the same query key and write through
 * the same functions, so they cannot disagree. Writers admit only admins and managers; a VA or any other reader gets
 * `canEdit: false` and read-only circles (the database refuses their writes as well).
 *
 * Every write is immediate and has an Undo. A write that does not land restores the previous state and says so, with a
 * Retry. A circle that is saving cannot be submitted twice.
 */
export function useContractReview(enabled = true) {
  const { isAdmin, isManager, isVaManager, isVa } = useAuth();
  const canRead = isAdmin || isManager || isVaManager || isVa;
  const canEdit = isAdmin || isManager;
  const qc = useQueryClient();
  const query = useQuery({ queryKey: CONTRACT_REVIEW_KEY, queryFn: fetchRoster, enabled: enabled && canRead, staleTime: 30_000, retry: 1 });

  // A change made in another session reaches this one as an INSERT on the audit table (scoped by row security).
  useRealtimeTable({ table: "contract_review_events", event: "INSERT", channelSuffix: "contract-review", coalesceMs: 750, enabled: enabled && canRead }, () => {
    void qc.invalidateQueries({ queryKey: CONTRACT_REVIEW_KEY });
  });

  const inFlight = useRef<Set<string>>(new Set());
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const begin = (k: string): boolean => {
    if (inFlight.current.has(k)) return false;
    inFlight.current.add(k); setPending(new Set(inFlight.current)); return true;
  };
  const end = (k: string) => { inFlight.current.delete(k); setPending(new Set(inFlight.current)); };

  const patchAgent = useCallback((agentId: string, fn: (a: ReviewAgent) => ReviewAgent) => {
    qc.setQueryData<ReviewRoster>(CONTRACT_REVIEW_KEY, (old) => old ? { ...old, agents: old.agents.map((a) => a.agent_id === agentId ? fn(a) : a) } : old);
  }, [qc]);
  const agentNow = useCallback((agentId: string): ReviewAgent | undefined =>
    qc.getQueryData<ReviewRoster>(CONTRACT_REVIEW_KEY)?.agents.find((a) => a.agent_id === agentId), [qc]);

  const setCircle = useCallback(async (agentId: string, carrier: ReviewCarrier, confirmed: boolean, opts?: { undo?: boolean }): Promise<boolean> => {
    if (!canEdit) return false;
    const k = `${agentId}:${carrier.key}`;
    const before = agentNow(agentId);
    const carriers = qc.getQueryData<ReviewRoster>(CONTRACT_REVIEW_KEY)?.carriers ?? [carrier];
    if (!before || !begin(k)) return false;
    const name = before.display_name;
    const was = before.marks[carrier.key] ?? null;
    const optimistic: MarkInfo | null = confirmed ? { at: new Date().toISOString(), by: null, by_name: "you" } : null;
    patchAgent(agentId, (a) => withMark(a, carriers, carrier.key, optimistic));
    let landed = false;
    try {
      const r = await saveMark(agentId, carrier.key, confirmed, !confirmed);
      if (r.ok) {
        landed = true;
        if (!opts?.undo) {
          toast.success(`${carrier.label} ${confirmed ? "confirmed" : "cleared"} for ${name}`, {
            action: { label: "Undo", onClick: () => { void setCircle(agentId, carrier, !confirmed, { undo: true }); } },
          });
        }
      } else if (r.conflict) {
        toast.message(`${name}'s ${carrier.label} was just changed somewhere else. Showing the saved state.`);
        patchAgent(agentId, (a) => withMark(a, carriers, carrier.key, r.confirmed ? { at: r.confirmedAt ?? new Date().toISOString(), by: null, by_name: "a team member" } : null));
      } else {
        patchAgent(agentId, (a) => withMark(a, carriers, carrier.key, was));
        toast.error(`${carrier.label} for ${name} did not save. It is back to ${was ? "confirmed" : "Not yet reviewed"}.${r.error ? ` ${r.error}` : ""}`, {
          action: { label: "Retry", onClick: () => { void setCircle(agentId, carrier, confirmed); } },
        });
      }
    } finally {
      end(k);
      void qc.invalidateQueries({ queryKey: CONTRACT_REVIEW_KEY });
    }
    return landed;
  }, [agentNow, canEdit, patchAgent, qc]);

  const setLevel = useCallback(async (agentId: string, pct: number | null): Promise<{ ok: boolean; error: string | null }> => {
    if (!canEdit) return { ok: false, error: "View only." };
    const k = `${agentId}:level`;
    const before = agentNow(agentId);
    if (!before || !begin(k)) return { ok: false, error: "Already saving." };
    const was = before.level;
    patchAgent(agentId, (a) => withLevel(a, pct === null ? null : { pct, source: "admin_ui", effective_from: null, updated_at: new Date().toISOString() }));
    try {
      const r = await saveLevel(agentId, pct, was ? was.pct : null);
      if (r.ok) {
        toast.success(pct === null ? `Level cleared for ${before.display_name}` : `Level set to ${pct}% for ${before.display_name}`, {
          action: { label: "Undo", onClick: () => { void setLevel(agentId, was ? was.pct : null); } },
        });
        return { ok: true, error: null };
      }
      patchAgent(agentId, (a) => withLevel(a, was));
      if (r.conflict) { toast.message(`${before.display_name}'s level was just changed somewhere else. Showing the saved value.`); return { ok: false, error: "Changed somewhere else." }; }
      return { ok: false, error: r.error ?? "Not saved." };
    } finally {
      end(k);
      void qc.invalidateQueries({ queryKey: CONTRACT_REVIEW_KEY });
    }
  }, [agentNow, canEdit, patchAgent, qc]);

  const saveProfile = useCallback(async (agentId: string, v: IntakeValues): Promise<ProfileResult> => {
    const k = `${agentId}:profile`;
    if (!canEdit) return { ok: false, field: null, conflict: null, otherName: null, error: "View only." };
    if (!begin(k)) return { ok: false, field: null, conflict: null, otherName: null, error: "Already saving." };
    try {
      const r = await saveProfileForAgent(agentId, v);
      if (r.ok) toast.success("Contracting profile saved");
      return r;
    } finally {
      end(k);
      void qc.invalidateQueries({ queryKey: CONTRACT_REVIEW_KEY });
    }
  }, [canEdit, qc]);

  return {
    query, roster: query.data ?? null, canRead, canEdit,
    setCircle, setLevel, saveProfile,
    isPending: (agentId: string, what: string) => pending.has(`${agentId}:${what}`),
  };
}
