import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";

// Retained as a terminal compatibility endpoint so old bookmarks and operator
// clients fail closed. Onboarding now uses the live APEX roadmap plus Slack;
// this endpoint performs no email, SMS, push, or messaging-channel delivery.
serve((req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  return new Response(
    JSON.stringify({
      success: false,
      retired: true,
      replacement: "slack_and_apex_roadmap",
      error: "This onboarding blast is retired and sends nothing.",
    }),
    {
      status: 410,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
});
