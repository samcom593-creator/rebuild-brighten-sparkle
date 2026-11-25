import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { recordingRequest } from "@/lib/recordingRequest";

/** A grade or provider URL is not a published, authorized private audio copy. */
export function useCallAudioAvailability(callId?: string) {
  const { user, isLoading } = useAuth();
  return useQuery({
    queryKey: ["call-audio-availability", user?.id, callId],
    enabled: !!user && !isLoading && !!callId,
    staleTime: Infinity, gcTime: 0, retry: false,
    refetchOnWindowFocus: false, refetchOnReconnect: false, refetchOnMount: false,
    meta: { silent: true },
    queryFn: async ({ signal }) => {
      try {
        const { data, error } = await recordingRequest(signal, requestSignal =>
          supabase.rpc("call_audio_for", { p_call_ids: [callId!] }).abortSignal(requestSignal));
        if (error || !Array.isArray(data)) throw new Error("Invalid recording availability.");
        if (data.length === 0) return false;
        const row = data[0];
        if (data.length !== 1 || !row || row.call_id?.toLowerCase() !== callId!.toLowerCase() ||
          typeof row.path !== "string" || !row.path.trim() ||
          !["full", "numbers_muted", "client_data_removed"].includes(row.variant)) throw new Error("Invalid recording availability.");
        // Keep only availability in the UI cache; the signer rechecks the exact path and caller at play time.
        return true;
      } catch {
        throw new Error("Recording availability could not be checked.");
      }
    },
  });
}
