import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useBusinessToday } from "@/hooks/useBusinessToday";
import { parseConversionPayload, type ConversionPayload } from "@/lib/homeConversions";

/**
 * The owner Home's conversion people (home_conversion_people, admin only). The strip and the
 * Selling agents number share this one read, so they can never disagree with each other or
 * with the lists they open. The key carries the Phoenix business day, so the numbers roll over
 * at Phoenix midnight like every other Home number.
 */
export function useHomeConversions() {
  const { isAdmin } = useAuth();
  const todayKey = useBusinessToday();
  return useQuery({
    queryKey: ["home-conversions", todayKey],
    enabled: Boolean(isAdmin),
    staleTime: 60_000,
    retry: 1,
    retryDelay: 4_000,
    queryFn: async (): Promise<ConversionPayload> => {
      const { data, error } = await supabase.rpc("home_conversion_people" as never, { p_today: todayKey } as never);
      if (error) throw error;
      const parsed = parseConversionPayload(data);
      // A reply that is not the expected shape is a failure, never an empty strip of zeros.
      if (!parsed) throw new Error("The conversion numbers came back in a shape this page cannot read.");
      return parsed;
    },
  });
}
