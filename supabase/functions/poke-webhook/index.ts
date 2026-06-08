// P9: Poke webhook receiver — Sam acks via "ack:<kind>" reply text
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ACK_PATTERN = /^ack:([\w_]+)/i;

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json();
    const message = String(body?.message || body?.text || "").trim();
    const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

    const match = ACK_PATTERN.exec(message);
    if (match) {
      const kind = match[1].toLowerCase();
      // Mark all unacked entries of this kind from the last 48h as acknowledged
      const cutoff = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
      const { error, count } = await supabase
        .from("poke_queue")
        .update({ acked_at: new Date().toISOString() }, { count: "exact" })
        .eq("kind", kind)
        .is("acked_at", null)
        .gte("created_at", cutoff);
      if (error) throw error;
      return new Response(
        JSON.stringify({ acked: count ?? 0, kind }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } },
      );
    }

    // Unknown message — log for visibility but don't fail
    await supabase.from("poke_queue").insert({
      kind: "inbound_unknown",
      payload: { raw: body },
    });
    return new Response(
      JSON.stringify({ ok: true, note: "unmatched inbound logged" }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } },
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } },
    );
  }
};

serve(handler);
