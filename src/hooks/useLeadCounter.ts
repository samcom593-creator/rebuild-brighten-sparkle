import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

// useLeadCounter — surfaces the lead_counter table's count + freshness.
//
// IMPORTANT (Sam, 2026-05-15): this counter is the internal Supabase
// number, NOT a live ReadyMode inventory feed. When the ReadyMode
// inventory pull is wired up, replace this hook with a call to that
// endpoint and add `source: 'readymode'` + `last_sync_at` to the return
// shape. Until then we expose `source: 'lead_counter'` and `updatedAt`
// so the UI can show "inventory may be syncing" instead of presenting a
// stale snapshot as fact.
export function useLeadCounter() {
  const [count, setCount] = useState<number>(0);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [available, setAvailable] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const fetchCount = async () => {
      const { data, error } = await supabase
        .from("lead_counter")
        .select("count, updated_at")
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      if (error || !data) {
        setAvailable(false);
        setIsLoading(false);
        return;
      }
      setCount(Number(data.count ?? 0));
      setUpdatedAt(data.updated_at ?? null);
      setIsLoading(false);
    };
    fetchCount();
    return () => { cancelled = true; };
  }, []);

  const ageHours = updatedAt
    ? (Date.now() - new Date(updatedAt).getTime()) / (1000 * 60 * 60)
    : null;
  const isStale = ageHours !== null && ageHours > 24;

  return {
    count,
    updatedAt,
    isLoading,
    available,
    isStale,
    source: "lead_counter" as const,
  };
}
