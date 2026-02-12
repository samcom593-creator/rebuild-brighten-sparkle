import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } }
);

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user: authUser }, error: userError } = await supabaseAdmin.auth.getUser(token);

    if (userError || !authUser) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify admin or manager role
    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", authUser.id);

    const isAdmin = roles?.some((r) => r.role === "admin");
    const isManager = roles?.some((r) => r.role === "manager");

    if (!isAdmin && !isManager) {
      return new Response(
        JSON.stringify({ error: "Only admins and managers can reset passwords" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { targetUserId, newPassword } = await req.json();

    if (!targetUserId || !newPassword) {
      return new Response(
        JSON.stringify({ error: "targetUserId and newPassword are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (newPassword.length < 6) {
      return new Response(
        JSON.stringify({ error: "Password must be at least 6 characters" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // If manager (not admin), verify target is in their downline
    if (!isAdmin && isManager) {
      const { data: callerAgent } = await supabaseAdmin
        .from("agents")
        .select("id")
        .eq("user_id", authUser.id)
        .single();

      const { data: targetAgent } = await supabaseAdmin
        .from("agents")
        .select("invited_by_manager_id")
        .eq("user_id", targetUserId)
        .single();

      if (!callerAgent || !targetAgent || targetAgent.invited_by_manager_id !== callerAgent.id) {
        return new Response(
          JSON.stringify({ error: "You can only reset passwords for your direct downline" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
      targetUserId,
      { password: newPassword }
    );

    if (updateError) {
      console.error("Error resetting password:", updateError);
      return new Response(
        JSON.stringify({ error: updateError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Update portal_password_set flag on agent
    await supabaseAdmin
      .from("agents")
      .update({ portal_password_set: true })
      .eq("user_id", targetUserId);

    console.log(`Admin ${authUser.id} reset password for user ${targetUserId}`);

    return new Response(
      JSON.stringify({ success: true, message: "Password reset successfully" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Unexpected error:", error);
    return new Response(
      JSON.stringify({ error: "An unexpected error occurred" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
};

serve(handler);
