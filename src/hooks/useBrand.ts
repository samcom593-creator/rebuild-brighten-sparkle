import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { resolveBrand, type Brand } from "@/config/brand";
import { useAuth } from "@/hooks/useAuth";

// The Agency Settings page saves agentcloud_agency_name to system_settings,
// but until this hook existed NOTHING read it back — Sam saved a new name and
// the sidebar kept saying the hardcoded default. system_settings is readable
// by every authenticated user (RLS SELECT true), writes stay admin-only.
export function useBrand(): Brand {
  const { user } = useAuth();
  const { data } = useQuery({
    queryKey: ["agency-branding", user?.id],
    enabled: Boolean(user?.id),
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_my_agency_branding" as never);
      if (error) throw error;
      return data as unknown as { display_name?: string } | null;
    },
  });
  const name = data?.display_name?.trim();
  if (!name) return resolveBrand();
  return resolveBrand({
    overrides: { legalName: name, platformName: name, shortName: name, productName: name },
  });
}
