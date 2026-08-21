import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { resolveBrand, type Brand } from "@/config/brand";

// The Agency Settings page saves agentcloud_agency_name to system_settings,
// but until this hook existed NOTHING read it back — Sam saved a new name and
// the sidebar kept saying the hardcoded default. system_settings is readable
// by every authenticated user (RLS SELECT true), writes stay admin-only.
export function useBrand(): Brand {
  const { data } = useQuery({
    queryKey: ["brand-overrides"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("system_settings")
        .select("key, value")
        .in("key", ["agentcloud_agency_name"]);
      if (error) throw error;
      return Object.fromEntries((data ?? []).map((r) => [r.key, r.value])) as Record<string, string>;
    },
  });
  const name = data?.agentcloud_agency_name?.trim();
  if (!name) return resolveBrand();
  return resolveBrand({
    overrides: { legalName: name, platformName: name, shortName: name, productName: name },
  });
}
