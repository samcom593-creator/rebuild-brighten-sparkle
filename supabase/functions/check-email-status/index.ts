import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const { email } = await req.json();

    if (!email) {
      throw new Error("Email is required");
    }

    const normalizedEmail = email.toLowerCase().trim();
    console.log(`Checking email status for: ${normalizedEmail}`);

    // Check if email exists in profiles table (CRM)
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("id, user_id, full_name, email")
      .ilike("email", normalizedEmail)
      .maybeSingle();

    if (profileError) {
      console.error("Error checking profiles:", profileError);
    }

    const inCRM = !!profile;
    const agentName = profile?.full_name || null;
    const profileUserId = profile?.user_id || null;

    // Check if there's an auth user with this email
    let hasAuthAccount = false;
    
    if (inCRM && profileUserId) {
      // Check if the user_id is a real auth user (not a placeholder UUID)
      // Placeholder UUIDs follow pattern like a1111111-1111-1111-1111-111111111111
      const isPlaceholderUUID = /^[a-f]1{7}-1{4}-1{4}-1{4}-1{12}$/i.test(profileUserId);
      
      if (!isPlaceholderUUID) {
        // Try to get the auth user by ID
        const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.getUserById(profileUserId);
        hasAuthAccount = !authError && !!authUser?.user;
      }
    }
    
    // Also check directly by email in auth.users
    if (!hasAuthAccount) {
      const { data: authUsers, error: listError } = await supabaseAdmin.auth.admin.listUsers({
        page: 1,
        perPage: 1000,
      });
      
      if (!listError && authUsers?.users) {
        // Search for user by email in the list
        const foundUser = authUsers.users.find(
          (u) => u.email?.toLowerCase() === normalizedEmail
        );
        hasAuthAccount = !!foundUser;
      }
    }

    console.log(`Email status: inCRM=${inCRM}, hasAuthAccount=${hasAuthAccount}, name=${agentName}`);

    return new Response(
      JSON.stringify({
        inCRM,
        hasAuthAccount,
        agentName,
      }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: any) {
    console.error("Error in check-email-status:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);
