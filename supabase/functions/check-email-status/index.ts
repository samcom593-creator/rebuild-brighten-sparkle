import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
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

    const { identifier, email } = await req.json();
    
    // Support both 'identifier' (new) and 'email' (legacy) params
    const input = identifier || email;

    if (!input) {
      throw new Error("Email or phone is required");
    }

    const trimmedInput = input.trim();
    
    // Detect if input is a phone number (contains mostly digits)
    const digitsOnly = trimmedInput.replace(/\D/g, "");
    const isPhone = /^[\d\s\-\(\)\+]+$/.test(trimmedInput) && digitsOnly.length >= 10;

    console.log(`Checking status for: ${trimmedInput} (isPhone: ${isPhone})`);

    let profile = null;
    let profileError = null;

    if (isPhone) {
      // Search by phone - try to match last 10 digits, use limit(1) to handle duplicates
      const last10 = digitsOnly.slice(-10);
      console.log(`Searching by phone, last 10 digits: ${last10}`);
      
      const { data, error } = await supabaseAdmin
        .from("profiles")
        .select("id, user_id, full_name, email, phone, city, state")
        .or(`phone.ilike.%${last10}%`)
        .order("created_at", { ascending: false })
        .limit(1);
      
      profile = data?.[0] || null;
      profileError = error;
    } else {
      // Search by email - use limit(1) to handle duplicates gracefully
      const normalizedEmail = trimmedInput.toLowerCase();
      console.log(`Searching by email: ${normalizedEmail}`);
      
      const { data, error } = await supabaseAdmin
        .from("profiles")
        .select("id, user_id, full_name, email, phone, city, state")
        .ilike("email", normalizedEmail)
        .order("created_at", { ascending: false })
        .limit(1);
      
      profile = data?.[0] || null;
      profileError = error;
    }

    if (profileError) {
      console.error("Error checking profiles:", profileError);
    }

    const inCRM = !!profile;
    const agentName = profile?.full_name || null;
    const agentPhone = profile?.phone || null;
    const agentCity = profile?.city || null;
    const agentState = profile?.state || null;
    const agentEmail = profile?.email || null;
    const profileUserId = profile?.user_id || null;

    // Check if agent requires password
    let passwordRequired = false;
    if (inCRM && profileUserId) {
      const { data: agentData } = await supabaseAdmin
        .from("agents")
        .select("password_required")
        .eq("user_id", profileUserId)
        .maybeSingle();
      
      passwordRequired = agentData?.password_required ?? false;
    }

    // Check if there's an auth user with this email
    let hasAuthAccount = false;
    
    if (inCRM && profileUserId) {
      // Check if the user_id is a real auth user (not a placeholder UUID)
      const isPlaceholderUUID = /^[a-f]1{7}-1{4}-1{4}-1{4}-1{12}$/i.test(profileUserId);
      
      if (!isPlaceholderUUID) {
        const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.getUserById(profileUserId);
        hasAuthAccount = !authError && !!authUser?.user;
      }
    }
    
    // Also check directly by email in auth.users if profile email exists
    if (!hasAuthAccount && agentEmail) {
      const { data: authUsers, error: listError } = await supabaseAdmin.auth.admin.listUsers({
        page: 1,
        perPage: 1000,
      });
      
      if (!listError && authUsers?.users) {
        const foundUser = authUsers.users.find(
          (u) => u.email?.toLowerCase() === agentEmail.toLowerCase()
        );
        hasAuthAccount = !!foundUser;
      }
    }

    console.log(`Status: inCRM=${inCRM}, hasAuthAccount=${hasAuthAccount}, passwordRequired=${passwordRequired}, name=${agentName}`);

    return new Response(
      JSON.stringify({
        inCRM,
        hasAuthAccount,
        passwordRequired,
        agentName,
        agentPhone,
        agentCity,
        agentState,
        agentEmail,
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
