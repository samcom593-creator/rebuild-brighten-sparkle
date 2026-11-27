import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireSendAuth } from "../_shared/require-send-auth.ts";
import { scanInactivity } from "./scan.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, "Content-Type": "application/json" },
});

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  try {
    // Same service-or-manager gate as the production-gap scanner. An anon key
    // is not authorization to build queues with the service-role client.
    const auth = await requireSendAuth(req);
    if (!auth.ok) return json({ error: auth.error }, auth.status);
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    return json(await scanInactivity(supabase));
  } catch (error) {
    console.error("detect-inactive-agents failed:", error);
    return json({ error: "The scan could not finish. Refresh the queue and retry; activity could not be fully verified." }, 500);
  }
});
