import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { FIRST_STEP_LINK_KEYS, firstStepLinksFromSettings, type FirstStepLinks } from "@/lib/firstStepsLinks";

/**
 * The Slack, Discord and call-booking links a manager sends a new hire, read from the same system_settings keys
 * the onboarding email sends (the way src/pages/GettingStarted.tsx reads its two), so the texted link and the
 * emailed link cannot drift apart. Non-admins can read these keys: the RLS policy on system_settings filters only
 * anything matching secret|token|cookie|password|_key. A failed read is an error, never three blank links.
 */
export function useFirstStepLinks() {
  return useQuery({
    queryKey: ["first-step-links"],
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<FirstStepLinks> => {
      const { data, error } = await supabase.from("system_settings").select("key,value").in("key", Object.values(FIRST_STEP_LINK_KEYS));
      if (error) throw error;
      return firstStepLinksFromSettings(data ?? []);
    },
  });
}
