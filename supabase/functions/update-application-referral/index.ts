import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

const uuidRegex =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ReferralSchema = z.object({
  applicationId: z.string().refine((v) => uuidRegex.test(v), "Invalid application id"),
  selectedReferrer: z.string().max(100),
  customReferrer: z.string().trim().max(120).optional().nullable(),
});

type ReferralRequest = z.infer<typeof ReferralSchema>;

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const raw = await req.json();
    const parsed = ReferralSchema.safeParse(raw);

    if (!parsed.success) {
      return new Response(
        JSON.stringify({ error: "Invalid input data", details: parsed.error.issues }),
        {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        },
      );
    }

    const data: ReferralRequest = parsed.data;
    const selected = data.selectedReferrer;

    if (!(selected === "none" || selected === "other" || uuidRegex.test(selected))) {
      return new Response(JSON.stringify({ error: "Invalid referrer" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // Enforce expected state to avoid arbitrary updates
    const { data: app, error: fetchError } = await supabaseAdmin
      .from("applications")
      .select("id,status,assigned_agent_id,notes")
      .eq("id", data.applicationId)
      .maybeSingle();

    if (fetchError) {
      console.error("update-application-referral fetch error:", fetchError);
      return new Response(JSON.stringify({ error: "Failed to update referral" }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    if (!app) {
      return new Response(JSON.stringify({ error: "Application not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    if (app.status !== "new") {
      return new Response(JSON.stringify({ error: "Application is not editable" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    if (app.assigned_agent_id) {
      return new Response(JSON.stringify({ error: "Referral already set" }), {
        status: 409,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // Apply update
    if (selected === "none") {
      // No update needed
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    if (selected === "other") {
      const ref = (data.customReferrer ?? "").trim();
      if (!ref) {
        return new Response(JSON.stringify({ error: "Custom referrer required" }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }

      const existingNotes = (app.notes ?? "").toString();
      const nextNotes = existingNotes
        ? `${existingNotes}\nReferred by: ${ref}`
        : `Referred by: ${ref}`;

      const { error: updateError } = await supabaseAdmin
        .from("applications")
        .update({ notes: nextNotes })
        .eq("id", data.applicationId);

      if (updateError) {
        console.error("update-application-referral update error:", updateError);
        return new Response(JSON.stringify({ error: "Failed to update referral" }), {
          status: 500,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // UUID referrer
    const { error: updateError } = await supabaseAdmin
      .from("applications")
      .update({ assigned_agent_id: selected })
      .eq("id", data.applicationId);

    if (updateError) {
      console.error("update-application-referral update error:", updateError);
      return new Response(JSON.stringify({ error: "Failed to update referral" }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (err) {
    console.error("update-application-referral unexpected error:", err);
    return new Response(JSON.stringify({ error: "Server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
};

serve(handler);
