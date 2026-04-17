import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createHandler } from "../_shared/handler.ts";
import { jsonResponse } from "../_shared/cors.ts";
import { parseBody, v } from "../_shared/validate.ts";

const BodySchema = v.object({
  niprNumber: v.string({ required: true, min: 1, max: 32 }),
  applicationId: v.uuid(),
  firstName: v.string({ max: 128 }),
  lastName: v.string({ max: 128 }),
  state: v.string({ required: true, min: 2, max: 4 }),
});

Deno.serve(
  createHandler(
    {
      functionName: "verify-nipr",
      rateLimit: { maxRequests: 30, windowSeconds: 60 },
    },
    async (req) => {
      const { niprNumber, applicationId, firstName, lastName, state } = await parseBody(req, BodySchema);

      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        { auth: { persistSession: false } }
      );

      const niprApiKey = Deno.env.get("NIPR_API_KEY");

      if (niprApiKey) {
        const response = await fetch(
          `https://pdb.nipr.com/pdbws/services/GetProducerInfo?npn=${encodeURIComponent(niprNumber)}&licenseState=${encodeURIComponent(state)}`,
          { headers: { Authorization: `Bearer ${niprApiKey}` } }
        );

        if (response.ok) {
          const data = await response.json();
          const isVerified = data?.producer?.status === "Active";
          const licensedStates = data?.producer?.licenses?.map((l: any) => l.state) || [];

          await supabase
            .from("applications")
            .update({
              nipr_verified: isVerified,
              nipr_verified_at: new Date().toISOString(),
              licensed_states: licensedStates,
              nipr_data: data?.producer || null,
            })
            .eq("id", applicationId);

          await supabase.from("notification_log").insert({
            notification_type: "nipr_verification",
            subject: `NIPR ${isVerified ? "Verified" : "Failed"}: ${firstName} ${lastName}`,
            body: `NPN: ${niprNumber}, State: ${state}, Result: ${isVerified ? "Active" : "Not Active"}`,
            application_id: applicationId,
            status: isVerified ? "verified" : "failed",
            channel: "system",
          });

          return jsonResponse({ verified: isVerified, states: licensedStates });
        }
      }

      // No API key — mark for manual verification
      await supabase
        .from("applications")
        .update({ nipr_verified: null })
        .eq("id", applicationId);

      return jsonResponse({
        verified: null,
        message: "Manual verification required — no NIPR API key configured",
      });
    }
  )
);
