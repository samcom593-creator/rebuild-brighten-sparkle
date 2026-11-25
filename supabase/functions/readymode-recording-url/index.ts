import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";
import { handleReadyModeRecordingUrl } from "../_shared/readymode-recording-url.ts";

Deno.serve((req) => {
  let userClient: ReturnType<typeof createClient> | null = null;
  const caller = () => userClient ??= createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false },
  });
  return handleReadyModeRecordingUrl(req, {
    getUser: async () => {
      const { data, error } = await caller().auth.getUser();
      return { userId: data.user?.id ?? null, error };
    },
    resolveRecording: (callId) => caller().rpc("call_audio_for", { p_call_ids: [callId] }),
    signRecording: (path, expiresInSeconds) => {
      // Preserve the RPC's own/downline/team/grant rules; no browser-selected path or variant.
      const service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
      return service.storage.from("readymode-audio").createSignedUrl(path, expiresInSeconds);
    },
  });
});
