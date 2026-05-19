import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface ApplicationManager {
  id: string;
  display_name: string;
  email: string | null;
  avatar_url: string | null;
  phone: string | null;
}

export interface ApplicationStatusSnapshot {
  application_id: string;
  first_name: string;
  last_name: string;
  license_status: "licensed" | "unlicensed" | "pending";
  status: string;
  status_label: string;
  status_step: number;
  status_steps_total: number;
  created_at: string;
  contacted_at: string | null;
  manager: ApplicationManager | null;
  next_seminar_at: string | null;
  telegram_url: string | null;
  telegram_label: string | null;
  support_url: string | null;
  next_video_url: string | null;
  culture_line: string | null;
}

// Single hook used by every post-submit page: ApplySuccess / Licensed /
// Unlicensed / public /status/:id. Caches per applicationId; revalidates on
// window focus so applicants who leave the tab and come back see fresh
// manager + status if the recruiting team has reacted.
export function useApplicationStatus(applicationId: string | null | undefined) {
  return useQuery<ApplicationStatusSnapshot | null>({
    queryKey: ["application-status", applicationId],
    enabled: !!applicationId,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
    queryFn: async () => {
      if (!applicationId) return null;
      const { data, error } = await (supabase.rpc as any)(
        "get_application_status",
        { p_application_id: applicationId },
      );
      if (error) throw error;
      if (!data || (data as any).error) return null;
      return data as ApplicationStatusSnapshot;
    },
  });
}
