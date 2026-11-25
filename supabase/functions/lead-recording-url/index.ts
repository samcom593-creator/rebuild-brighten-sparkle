import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";
import { handleLeadRecordingUrl } from "../_shared/lead-recording-url.ts";

Deno.serve((req) => {
  let userClient: ReturnType<typeof createClient> | null = null;
  const caller = () => userClient ??= createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false },
  });
  return handleLeadRecordingUrl(req, {
    getUser: async () => {
      const { data, error } = await caller().auth.getUser();
      return { userId: data.user?.id ?? null, error };
    },
    // This RPC enforces the existing sold-call review grant using the caller JWT.
    // The review screen shows the newest 40; the larger authorized window tolerates new uploads.
    listRecordings: () => caller().rpc("lead_recordings_recent", { p_limit: 200 }),
    signRecording: (path, expiresInSeconds) => {
      const service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
      return service.storage.from("call-recordings").createSignedUrl(path, expiresInSeconds);
    },
  });
});
