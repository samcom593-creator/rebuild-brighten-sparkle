// Retired legacy interview writer. The app uses interviews-pipeline, whose
// transition allowlist, VA ownership scope, optimistic version check, and
// activity receipt are the canonical interview workflow.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  return new Response(JSON.stringify({
    error: "This endpoint is retired. Use interviews-pipeline.",
    code: "INTERVIEW_ENDPOINT_RETIRED",
  }), {
    status: 410,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
});
