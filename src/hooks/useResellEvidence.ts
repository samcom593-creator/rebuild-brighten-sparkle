// useResellEvidence (OVERHAUL-resells, 2026-10-29): the dialer and sold-call evidence for a list of people,
// read in one call from public.resell_evidence() (SECURITY INVOKER, so the viewer only ranks on calls
// their own access lets them read). Easy Resells and Book Flips both use it, so both pages rank on the
// same facts. The page decides what to do while it loads or when it fails; nothing here invents a zero.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { indexEvidence, nameKey, phoneKey, type EvidenceIndex, type EvidenceRow, type EvidenceSubject } from "@/lib/resellEvidence";

export const RESELL_EVIDENCE_KEY = "resell-evidence";

type RangedRpc = (fn: string, args: Record<string, unknown>) => {
  range: (from: number, to: number) => Promise<{ data: unknown; error: { message: string } | null }>;
};

/** The unique keys to ask about, sorted, and a short signature of them for the cache key. */
export function evidenceRequest(subjects: readonly EvidenceSubject[]): { phones: string[]; names: string[]; signature: string } {
  const phones = new Set<string>();
  const names = new Set<string>();
  for (const s of subjects) {
    const p = phoneKey(s.phone);
    if (p) phones.add(p);
    const n = nameKey(s.firstName, s.lastName, s.fullName);
    if (n) names.add(n);
  }
  const p = [...phones].sort();
  const n = [...names].sort();
  // djb2 over the joined keys: enough to tell one list of people from another in the query cache.
  let h = 5381;
  for (const ch of `${p.join(",")}|${n.join(",")}`) h = ((h << 5) + h + ch.charCodeAt(0)) | 0;
  return { phones: p, names: n, signature: `${p.length}.${n.length}.${(h >>> 0).toString(36)}` };
}

export async function fetchResellEvidence(phones: string[], names: string[]): Promise<EvidenceIndex> {
  // PostgREST answers at most 1000 rows per request; the function orders its rows, so the pages never overlap.
  const rows: EvidenceRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await (supabase.rpc as unknown as RangedRpc)("resell_evidence", { p_phones: phones, p_names: names }).range(from, from + 999);
    if (error) throw new Error(error.message);
    const page = (Array.isArray(data) ? data : []) as EvidenceRow[];
    rows.push(...page);
    if (page.length < 1000) break;
  }
  return indexEvidence(rows);
}

export function useResellEvidence(subjects: readonly EvidenceSubject[], { enabled, scope }: { enabled: boolean; scope: string }) {
  const req = useMemo(() => evidenceRequest(subjects), [subjects]);
  const empty = req.phones.length === 0 && req.names.length === 0;
  const q = useQuery({
    queryKey: [RESELL_EVIDENCE_KEY, scope, req.signature],
    enabled: enabled && !empty,
    staleTime: 5 * 60_000,
    queryFn: () => fetchResellEvidence(req.phones, req.names),
    // When the same list changes (a person marked resold leaves it), the evidence already on screen stays
    // while the new read runs, so the list does not blink to a skeleton and re-sort under the caller. A
    // different list (another carrier) waits for its own evidence instead of ranking on someone else's.
    placeholderData: (previous, previousQuery) => (previousQuery?.queryKey[1] === scope ? previous : undefined),
  });
  // Nobody to ask about is an answer (nothing on file), not a load that never finished.
  const settled = enabled && empty;
  return {
    index: q.data,
    isLoading: !settled && enabled && (q.isLoading || q.isPending),
    isError: !settled && q.isError,
    error: q.error as Error | null,
    isReady: settled || q.isSuccess,
    refetch: q.refetch,
  };
}
