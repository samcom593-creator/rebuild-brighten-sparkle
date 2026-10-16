// useBookClientDetails — the client's phone, date of birth, state/city and Book Flips
// resale state for the Book of Business rows on screen.
//
// v_production_unified carries only the client's name, so a row could not be called or
// identified from the page. book_client_details(jsonb) looks each row up in deals, the
// AgentLink snapshot and the carrier books (v_book_flip_worklist). It is SECURITY INVOKER:
// every lookup runs under the caller's own row rules, so it reveals nothing a login could
// not already read. Rows are fetched in the same 60-row chunks the list paints, so
// "Show more" asks only for the new rows.
import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface BookClientDetails {
  row_key: string;
  phone: string | null;
  dob: string | null;
  state: string | null;
  city: string | null;
  do_not_call: boolean | null;
  best_time_to_call: string | null;
  flip_carrier: string | null;
  flip_policy_number: string | null;
  flip_client_key: string | null;
  flip_status: string | null;
  resold_policy_number: string | null;
  resold_carrier: string | null;
  resold_annual_premium: number | null;
}

export interface BookClientRowRef {
  row_key: string;
  origin: string | null;
  policy_number: string | null;
  carrier: string | null;
}

export const BOOK_CLIENT_DETAILS_KEY = "book-client-details";
const CHUNK = 60;

export function useBookClientDetails(rows: BookClientRowRef[], enabled = true) {
  const chunks = useMemo(() => {
    const out: BookClientRowRef[][] = [];
    for (let i = 0; i < rows.length; i += CHUNK) out.push(rows.slice(i, i + CHUNK));
    return out;
  }, [rows]);

  const results = useQueries({
    queries: chunks.map((chunk) => ({
      queryKey: [BOOK_CLIENT_DETAILS_KEY, chunk.map((r) => r.row_key).join("|")],
      enabled: enabled && chunk.length > 0,
      staleTime: 60_000,
      queryFn: async (): Promise<BookClientDetails[]> => {
        const { data, error } = await supabase.rpc("book_client_details" as never, {
          p_rows: chunk.map((r) => ({ row_key: r.row_key, origin: r.origin, policy_number: r.policy_number, carrier: r.carrier })),
        } as never);
        // supabase-js resolves with {error} instead of throwing; raise it as an Error so the
        // message (not "unknown error") reaches the row.
        if (error) throw new Error((error as { message?: string }).message ?? "unknown error");
        return (Array.isArray(data) ? data : []) as unknown as BookClientDetails[];
      },
    })),
  });

  return useMemo(() => {
    const byKey = new Map<string, BookClientDetails>();
    const loading = new Set<string>();
    let failed: string | null = null;
    results.forEach((res, i) => {
      if (res.data) for (const d of res.data) byKey.set(d.row_key, d);
      if (res.isPending) for (const r of chunks[i] ?? []) loading.add(r.row_key);
      if (res.isError && !failed) failed = (res.error as { message?: string } | null)?.message ?? "unknown error";
    });
    return { byKey, loading, failed, retry: () => results.forEach((r) => { if (r.isError) void r.refetch(); }) };
  }, [results, chunks]);
}
