// useSoldCallKeys — admin-only lookup of which clients/deals have a ReadyMode
// "Completed Sale" booking packet, so list dashboards can badge/filter the
// matching records. Fetches the ~small set of match keys once and returns a
// fast membership test by phone (preferred) or full name.
import { useQuery } from "@tanstack/react-query";
import { looseSupabase } from "@/lib/looseSupabase";
import { useAuth } from "@/hooks/useAuth";

// Admins + Aisha Kebbeh only (Sam's directive) — sold-call data is sensitive (SSN/bank).
export const SOLD_CALL_EXTRA_UID = "66bc4464-f10b-4ecf-8e8b-144486f18a44";

const digits10 = (s?: string | null) => (s ? s.replace(/[^0-9]/g, "").slice(-10) : "");
const nameKey = (f?: string | null, l?: string | null) =>
  `${(f ?? "").trim().toLowerCase()}|${(l ?? "").trim().toLowerCase()}`;

interface KeyRow { match_phone10: string | null; match_first: string | null; match_last: string | null }

export interface SoldCallKeys {
  ready: boolean;
  count: number;
  /** True if a record with this phone or name has a sold call on file. */
  has: (phone?: string | null, first?: string | null, last?: string | null) => boolean;
}

export function useSoldCallKeys(): SoldCallKeys {
  const { isAdmin, user } = useAuth();
  const canView = !!isAdmin || user?.id === SOLD_CALL_EXTRA_UID;
  const q = useQuery({
    queryKey: ["sold-call-keys"],
    enabled: canView,
    staleTime: 120_000,
    queryFn: async () => {
      const { data } = await (looseSupabase
        .from("v_sold_call_packets")
        .select("match_phone10, match_first, match_last")
        .limit(2000) as unknown as Promise<{ data: KeyRow[] | null }>);
      const phones = new Set<string>();
      const names = new Set<string>();
      for (const r of data ?? []) {
        if (r.match_phone10) phones.add(r.match_phone10);
        const nk = `${r.match_first ?? ""}|${r.match_last ?? ""}`;
        if (nk !== "|") names.add(nk);
      }
      return { phones, names };
    },
  });
  const phones = q.data?.phones;
  const names = q.data?.names;
  return {
    ready: canView && q.isSuccess,
    count: (phones?.size ?? 0),
    has: (phone, first, last) => {
      if (!canView || !phones) return false;
      const p = digits10(phone);
      if (p && phones.has(p)) return true;
      const nk = nameKey(first, last);
      return nk !== "|" && !!names && names.has(nk);
    },
  };
}
