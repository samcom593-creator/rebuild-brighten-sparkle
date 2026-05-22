import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// PL-SEMINAR-FUNNEL: returns the seminar invite snapshot rendered on
// /apply/success, /apply/success/licensed, /apply/success/unlicensed, and
// /status/:id. Backed by the get_application_seminar_invite(uuid) RPC.
//
// Resilient by design:
//   - Polls for a short window after submission so the fire-and-forget
//     seminar-confirmation edge fn has time to stamp the application row.
//   - Falls back to fn_next_seminar_slot() values from the RPC itself if
//     the row has not been stamped yet, so the page is never blank.
export interface SeminarInviteSnapshot {
  application_id: string;
  slot_at: string | null;
  invited_at: string | null;
  zoom_url: string | null;
  zoom_meeting_id: string | null;
  passcode: string | null;
  schedule_label: string | null;
  telegram_dm_url: string | null;
  ics_uid: string | null;
}

export function useApplicationSeminarInvite(applicationId: string | null | undefined) {
  return useQuery<SeminarInviteSnapshot | null>({
    queryKey: ["application-seminar-invite", applicationId],
    enabled: !!applicationId,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
    // Re-fetch every 4s for the first ~40s after the page mounts so the
    // success page picks up the stamped invited_at + zoom snapshot as soon
    // as the background edge fn finishes.
    refetchInterval: (query) => {
      const data = query.state.data as SeminarInviteSnapshot | null | undefined;
      if (data?.invited_at) return false;
      if ((query.state.dataUpdateCount ?? 0) >= 10) return false;
      return 4000;
    },
    queryFn: async () => {
      if (!applicationId) return null;
      const { data, error } = await (supabase.rpc as any)(
        "get_application_seminar_invite",
        { p_application_id: applicationId },
      );
      if (error) throw error;
      if (!data || (data as any).error) return null;
      return data as SeminarInviteSnapshot;
    },
  });
}
