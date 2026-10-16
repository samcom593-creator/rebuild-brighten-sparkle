// useSoldCallKeys — admin-only lookup of which clients/deals have a ReadyMode
// "Completed Sale" booking packet, so list dashboards can badge/filter the
// matching records. Fetches the ~small set of match keys once and returns a
// fast membership test by phone (preferred) or full name.
import { useQuery } from "@tanstack/react-query";
import { looseSupabase } from "@/lib/looseSupabase";
import { useAuth } from "@/hooks/useAuth";

// Admins + Aisha Kebbeh only (Sam's directive) — sold-call data is sensitive (SSN/bank).
export const SOLD_CALL_EXTRA_UID = "66bc4464-f10b-4ecf-8e8b-144486f18a44";

/** The front-end mirror of can_view_sold_calls(): admins and Aisha. The database decides. */
export function canViewSoldCalls(isAdmin: boolean, userId: string | null | undefined): boolean {
  return isAdmin || userId === SOLD_CALL_EXTRA_UID;
}

const digits10 = (s?: string | null) => (s ? s.replace(/[^0-9]/g, "").slice(-10) : "");
const nameKey = (f?: string | null, l?: string | null) =>
  `${(f ?? "").trim().toLowerCase()}|${(l ?? "").trim().toLowerCase()}`;

interface KeyRow {
  lead_phone: string | null;
  lead_first_name: string | null;
  lead_last_name: string | null;
  client_first_name: string | null;
  client_last_name: string | null;
}

export interface SoldCallKeys {
  ready: boolean;
  count: number;
  /** True if a record with this phone or name has a sold call on file. */
  has: (phone?: string | null, first?: string | null, last?: string | null) => boolean;
}

export function useSoldCallKeys(): SoldCallKeys {
  const { isAdmin, user } = useAuth();
  const canView = canViewSoldCalls(!!isAdmin, user?.id);
  const q = useQuery({
    queryKey: ["sold-call-keys"],
    enabled: canView,
    staleTime: 120_000,
    queryFn: async () => {
      // Every ReadyMode Completed Sale, packet or not: 33 sales have no packet (no recording,
      // or too short to hold an application) and still mean "this client bought on a call".
      // A failed read throws, so it retries and never caches as "no sold calls".
      const { data, error } = await (looseSupabase
        .from("v_sold_calls_queue")
        .select("lead_phone, lead_first_name, lead_last_name, client_first_name, client_last_name")
        .limit(5000) as unknown as Promise<{ data: KeyRow[] | null; error: { message: string } | null }>);
      if (error) throw new Error(error.message);
      const phones = new Set<string>();
      const names = new Set<string>();
      for (const r of data ?? []) {
        const p = digits10(r.lead_phone);
        if (p.length === 10) phones.add(p);
        for (const [f, l] of [[r.lead_first_name, r.lead_last_name], [r.client_first_name, r.client_last_name]]) {
          const nk = nameKey(f, l);
          if (nk !== "|" && f && l) names.add(nk);
        }
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
