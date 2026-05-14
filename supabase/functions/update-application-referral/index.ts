import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
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

    if (!(selected === "" || selected === "none" || selected === "other" || uuidRegex.test(selected))) {
      return new Response(JSON.stringify({ error: "Invalid referrer" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // Enforce expected state to avoid arbitrary updates
    const { data: app, error: fetchError } = await supabaseAdmin
      .from("applications")
      .select("id,status,assigned_agent_id,referral_manager_id,recruiter_id,notes")
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

    // Determine "unclaimed" dynamically: an app is reassignable if it has no
    // referral_manager_id AND no explicit recruiter_id AND its assigned_agent_id
    // either is null or points to an agent whose user has the 'admin' role
    // (i.e., it was caught by the default-routing trigger, not chosen by an
    // applicant). This replaces the old hardcoded ADMIN_DEFAULT_ID check that
    // silently failed after the canonical Sam agent id changed.
    let isUnclaimed = false;
    if (!app.referral_manager_id && !app.recruiter_id) {
      if (!app.assigned_agent_id) {
        isUnclaimed = true;
      } else {
        const { data: assignedAgent } = await supabaseAdmin
          .from("agents")
          .select("user_id")
          .eq("id", app.assigned_agent_id)
          .maybeSingle();
        if (assignedAgent?.user_id) {
          const { data: roleRow } = await supabaseAdmin
            .from("user_roles")
            .select("role")
            .eq("user_id", assignedAgent.user_id)
            .eq("role", "admin")
            .maybeSingle();
          isUnclaimed = !!roleRow;
        }
      }
    }

    if (!isUnclaimed) {
      return new Response(JSON.stringify({ error: "Referral already set", code: "ALREADY_CLAIMED" }), {
        status: 409,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // Apply update
    if (selected === "" || selected === "none") {
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

    // UUID referrer (manager selected) — also populate referral_manager_id so
    // recruit-credit dashboards that filter on either column show the right
    // credit (Sam 2026-04-27: KJ/Jay's pull-ups were invisible because this
    // column was null even though assigned_agent_id was right).
    const { error: updateError } = await supabaseAdmin
      .from("applications")
      .update({ assigned_agent_id: selected, referral_manager_id: selected })
      .eq("id", data.applicationId);

    if (updateError) {
      console.error("update-application-referral update error:", updateError);
      return new Response(JSON.stringify({ error: "Failed to update referral" }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // Notify the manager about the referral (fire-and-forget)
    try {
      const notifyUrl = `${supabaseUrl}/functions/v1/notify-manager-referral`;
      fetch(notifyUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify({
          applicationId: data.applicationId,
          managerId: selected,
        }),
      }).catch((err) => {
        console.error("Failed to trigger manager notification:", err);
      });
    } catch (notifyErr) {
      console.error("Error triggering manager notification:", notifyErr);
      // Don't fail the main request
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
