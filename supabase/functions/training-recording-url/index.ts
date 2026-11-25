import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";
import { handleTrainingRecordingUrl } from "../_shared/training-recording-url.ts";

Deno.serve((req) => {
  let userClient: ReturnType<typeof createClient> | null = null;
  const caller = () => userClient ??= createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false },
  });
  return handleTrainingRecordingUrl(req, {
    getUser: async () => {
      const { data, error } = await caller().auth.getUser();
      return { userId: data.user?.id ?? null, error };
    },
    listRecordings: () => caller().rpc("training_recordings_list"),
    signRecording: (path, expiresInSeconds) => {
      // Reached only for an exact object in the caller-authorized catalog.
      // The storage policy cannot read that private table directly; no table/bucket grants are broadened.
      const service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
      return service.storage.from("training-recordings").createSignedUrl(path, expiresInSeconds);
    },
  });
});
