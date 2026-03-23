import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Validate JWT
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: claims, error: claimsError } = await supabaseAdmin.auth.getUser(token);
    if (claimsError || !claims?.user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const userId = claims.user.id;
    const userEmail = claims.user.email?.toLowerCase().trim();
    console.log(`Self-enroll request from user ${userId} (${userEmail})`);

    // 1. Check if agent record already exists
    const { data: existingAgent } = await supabaseAdmin
      .from("agents")
      .select("id, has_training_course")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1);

    if (existingAgent && existingAgent.length > 0) {
      const agent = existingAgent[0];
      // Just ensure has_training_course is true
      if (!agent.has_training_course) {
        await supabaseAdmin
          .from("agents")
          .update({ has_training_course: true, onboarding_stage: "training_online" })
          .eq("id", agent.id);
        console.log(`Updated existing agent ${agent.id} with has_training_course=true`);
      }
      return new Response(
        JSON.stringify({ success: true, agentId: agent.id, action: "updated" }),
        { headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // 2. No agent record — check for licensed application
    if (!userEmail) {
      return new Response(
        JSON.stringify({ error: "No email found for user", noLicense: true }),
        { status: 404, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const { data: apps } = await supabaseAdmin
      .from("applications")
      .select("id, first_name, last_name, email, phone, assigned_agent_id, license_status")
      .ilike("email", userEmail)
      .eq("license_status", "licensed")
      .order("created_at", { ascending: false })
      .limit(1);

    if (!apps || apps.length === 0) {
      console.log(`No licensed application found for ${userEmail}`);
      return new Response(
        JSON.stringify({ error: "No licensed application found", noLicense: true }),
        { status: 404, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const app = apps[0];
    console.log(`Found licensed application for ${app.first_name} ${app.last_name}`);

    // 3. Get or create profile
    const { data: existingProfile } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("user_id", userId)
      .limit(1);

    let profileId: string;

    if (existingProfile && existingProfile.length > 0) {
      profileId = existingProfile[0].id;
    } else {
      const { data: newProfile, error: profileErr } = await supabaseAdmin
        .from("profiles")
        .insert({
          user_id: userId,
          email: userEmail,
          full_name: `${app.first_name} ${app.last_name}`,
          phone: app.phone || null,
        })
        .select("id")
        .single();

      if (profileErr || !newProfile) {
        console.error("Failed to create profile:", profileErr);
        return new Response(
          JSON.stringify({ error: "Failed to create profile" }),
          { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }
      profileId = newProfile.id;
    }

    // 4. Ensure user_roles has 'agent'
    const { data: existingRoles } = await supabaseAdmin
      .from("user_roles")
      .select("id")
      .eq("user_id", userId)
      .eq("role", "agent");

    if (!existingRoles || existingRoles.length === 0) {
      await supabaseAdmin.from("user_roles").insert({ user_id: userId, role: "agent" });
    }

    // 5. Create agent record
    const { data: newAgent, error: agentErr } = await supabaseAdmin
      .from("agents")
      .insert({
        user_id: userId,
        profile_id: profileId,
        invited_by_manager_id: app.assigned_agent_id || null,
        status: "active",
        license_status: "licensed",
        onboarding_stage: "training_online",
        has_training_course: true,
      })
      .select("id")
      .single();

    if (agentErr || !newAgent) {
      console.error("Failed to create agent:", agentErr);
      return new Response(
        JSON.stringify({ error: "Failed to create agent record" }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    console.log(`Created agent ${newAgent.id} for ${app.first_name} ${app.last_name}`);

    // 6. Send course enrollment email (fire and forget)
    supabaseAdmin.functions.invoke("send-course-enrollment-email", {
      body: {
        agentName: `${app.first_name} ${app.last_name}`,
        agentEmail: userEmail,
        agentId: newAgent.id,
      },
    }).catch((err) => console.log("Course enrollment email skipped:", err));

    return new Response(
      JSON.stringify({ success: true, agentId: newAgent.id, action: "created" }),
      { headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: unknown) {
    console.error("Self-enroll error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
});
