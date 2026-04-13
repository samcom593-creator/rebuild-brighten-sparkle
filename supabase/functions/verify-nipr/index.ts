import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const { niprNumber, applicationId, firstName, lastName, state } = await req.json();
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const niprApiKey = Deno.env.get("NIPR_API_KEY");

    if (niprApiKey) {
      const response = await fetch(
        `https://pdb.nipr.com/pdbws/services/GetProducerInfo?npn=${niprNumber}&licenseState=${state}`,
        { headers: { Authorization: `Bearer ${niprApiKey}` } }
      );

      if (response.ok) {
        const data = await response.json();
        const isVerified = data?.producer?.status === "Active";
        const licensedStates = data?.producer?.licenses?.map((l: any) => l.state) || [];

        await supabase.from("applications").update({
          nipr_verified: isVerified,
          nipr_verified_at: new Date().toISOString(),
          licensed_states: licensedStates,
          nipr_data: data?.producer || null,
        }).eq("id", applicationId);

        // Log to notification_log
        await supabase.from("notification_log").insert({
          notification_type: "nipr_verification",
          subject: `NIPR ${isVerified ? "Verified" : "Failed"}: ${firstName} ${lastName}`,
          body: `NPN: ${niprNumber}, State: ${state}, Result: ${isVerified ? "Active" : "Not Active"}`,
          application_id: applicationId,
          status: isVerified ? "verified" : "failed",
          channel: "system",
        });

        return new Response(JSON.stringify({ verified: isVerified, states: licensedStates }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // No API key — mark for manual verification
    await supabase.from("applications").update({
      nipr_verified: null,
    }).eq("id", applicationId);

    return new Response(JSON.stringify({ verified: null, message: "Manual verification required — no NIPR API key configured" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("NIPR verification error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
