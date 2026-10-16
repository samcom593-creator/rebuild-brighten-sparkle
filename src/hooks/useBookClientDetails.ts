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
import { keepPreviousData, useQueries } from "@tanstack/react-query";
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
  attempts: number | null;
  last_contact_at: string | null;
  callback_at: string | null;
  notes: string | null;
}

export interface BookClientRowRef {
  row_key: string;
  origin: string | null;
  policy_number: string | null;
  carrier: string | null;
  /** Matches the row to its own client: 72 policy numbers are shared by more than one client. */
  client_name: string | null;
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
      // A new deal shifts every chunk by one row, which changes every key. Keep the rows on
      // screen while the new chunks load instead of flashing them all back to skeletons.
      placeholderData: keepPreviousData,
      queryFn: async (): Promise<BookClientDetails[]> => {
        const { data, error } = await supabase.rpc("book_client_details" as never, {
          p_rows: chunk.map((r) => ({ row_key: r.row_key, origin: r.origin, policy_number: r.policy_number, carrier: r.carrier, client_name: r.client_name })),
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
    const failedKeys = new Set<string>();
    let failed: string | null = null;
    // Fresh answers first, so a chunk's placeholder (the previous chunk's rows) never overrides them.
    const order = results.map((res, i) => ({ res, i })).sort((a, b) => Number(b.res.isPlaceholderData) - Number(a.res.isPlaceholderData));
    for (const { res } of order) if (res.data) for (const d of res.data) byKey.set(d.row_key, d);
    results.forEach((res, i) => {
      const chunk = chunks[i] ?? [];
      if (res.isPending) for (const r of chunk) loading.add(r.row_key);
      // Still loading a row the placeholder does not hold: a skeleton, not "not on file".
      if (res.isPlaceholderData) for (const r of chunk) if (!byKey.has(r.row_key)) loading.add(r.row_key);
      if (res.isError) {
        failed ??= (res.error as { message?: string } | null)?.message ?? "unknown error";
        for (const r of chunk) failedKeys.add(r.row_key);
      }
    });
    return { byKey, loading, failed, failedKeys, retry: () => results.forEach((r) => { if (r.isError) void r.refetch(); }) };
  }, [results, chunks]);
}
