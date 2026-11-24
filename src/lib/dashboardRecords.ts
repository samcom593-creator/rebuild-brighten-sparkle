import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { businessDateKey } from "@/lib/businessClock";

const PAGE_SIZE = 500;
export type ManagerProductionRow = Pick<Tables<"v_production_canonical">,
  "row_key" | "agent_id" | "agent_name" | "annual_premium" | "carrier" | "status" | "posted_date">;
export type PlaqueFact = Pick<Tables<"plaque_awards">, "id" | "agent_id" | "amount" | "awarded_at">;

/** Fully read each bounded page; an error never becomes a partial headline total. */
async function completeRows<T>(load: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>, key: (row: T) => string | null): Promise<T[]> {
  const rows: T[] = [];
  const seen = new Set<string>();
  for (let from = 0; from < 50_000; from += PAGE_SIZE) {
    const { data, error } = await load(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    if (!Array.isArray(data)) throw new Error("The full record list could not be verified.");
    for (const row of data) {
      const id = key(row);
      if (!id || seen.has(id)) throw new Error("The record list changed while loading. Retry to verify the totals.");
      seen.add(id); rows.push(row);
    }
    if (data.length < PAGE_SIZE) return rows;
  }
  throw new Error("This history is too large for a verified dashboard read. A server summary is required.");
}

export async function loadManagerProduction(today: string, signal?: AbortSignal): Promise<ManagerProductionRow[]> {
  const since = new Date(`${today}T12:00:00Z`);
  since.setUTCDate(since.getUTCDate() - 29);
  return completeRows((from, to) => {
    const query = supabase.from("v_production_canonical")
      .select("row_key,agent_id,agent_name,annual_premium,carrier,status,posted_date")
      .gte("posted_date", since.toISOString().slice(0, 10)).lte("posted_date", today)
      .order("posted_date", { ascending: false }).order("row_key", { ascending: true }).range(from, to);
    return signal ? query.abortSignal(signal) : query;
  }, row => row.row_key);
}

export async function loadPlaqueFacts(signal?: AbortSignal): Promise<PlaqueFact[]> {
  return completeRows((from, to) => {
    const query = supabase.from("plaque_awards").select("id,agent_id,amount,awarded_at")
      .order("id", { ascending: true }).range(from, to);
    return signal ? query.abortSignal(signal) : query;
  }, row => row.id);
}

export function summarizePlaques(rows: readonly PlaqueFact[], today: string) {
  const month = today.slice(0, 7);
  return {
    total: rows.length,
    totalAwarded: rows.reduce((sum, row) => sum + Number(row.amount ?? 0), 0),
    honorees: new Set(rows.map(row => row.agent_id)).size,
    thisMonth: rows.filter(row => row.awarded_at && businessDateKey(new Date(row.awarded_at).getTime(), "America/Phoenix").slice(0, 7) === month).length,
  };
}
