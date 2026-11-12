import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useBusinessToday } from "@/hooks/useBusinessToday";
import { parseConversionPayload, type ConversionPayload } from "@/lib/homeConversions";

/** Inclusive Phoenix business days. */
export interface ConversionRange {
  start: string;
  end: string;
}

/**
 * The owner Home's conversion people (admin only). The strip and the Selling agents number
 * share this one read, so they can never disagree with each other or with the lists they open.
 *
 * MP-302: with a range, the read is home_conversion_people_range for exactly those dates, the
 * same window the production scoreboard is showing. Without one it is the original fixed
 * windows (today, last 7 days). The key carries the Phoenix business day, so the numbers roll
 * over at Phoenix midnight like every other Home number.
 */
export function useHomeConversions(range?: ConversionRange | null) {
  const { isAdmin } = useAuth();
  const todayKey = useBusinessToday();
  return useQuery({
    queryKey: range ? ["home-conversions", "range", range.start, range.end, todayKey] : ["home-conversions", todayKey],
    enabled: Boolean(isAdmin),
    staleTime: 60_000,
    retry: 1,
    retryDelay: 4_000,
    queryFn: async (): Promise<ConversionPayload> => {
      const { data, error } = range
        ? await supabase.rpc("home_conversion_people_range" as never, { p_start: range.start, p_end: range.end } as never)
        : await supabase.rpc("home_conversion_people" as never, { p_today: todayKey } as never);
      if (error) throw error;
      const parsed = parseConversionPayload(data);
      // A reply that is not the expected shape is a failure, never an empty strip of zeros.
      if (!parsed) throw new Error("The conversion numbers came back in a shape this page cannot read.");
      return parsed;
    },
  });
}
