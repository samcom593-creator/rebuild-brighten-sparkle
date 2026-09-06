import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { emailPattern } from "../_shared/like-escape.ts";

// check-email-status — MP-448 (2026-09-06)
//
// WHAT THIS ENDPOINT IS FOR
// Step 1 of AgentNumbersLogin: a visitor with no session types the identifier
// their login form asks for, and the page needs to know which of three steps to
// show them — password, set-password, or create-account. It runs verify_jwt =
// false because the only legitimate caller is a browser that has no session yet
// and carries nothing but the public anon key, which ships inside the bundle.
// MP-443 measured that the gateway ACCEPTS that key, so flipping verify_jwt on
// would not gate anything; the limit has to be on WHAT is returned, not on who
// may ask. That is the same shape MP-447 settled on for applicant-magic-link.
//
// THE BUG THIS EXISTS FOR
// It answered with the matched profile's full_name, phone, city, state AND
// email to a caller holding no credential of any kind. Proven against prod on
// 2026-09-06: a bare POST with no Authorization header returned Sam's own name,
// phone, city, state and address. Four of those fields are read by NO caller —
// the one invoker destructures inCRM, hasAuthAccount, agentName and agentEmail
// and nothing else — so they were pure disclosure with no product behind them.
//
// WHY IT WAS HARVESTABLE AND NOT MERELY LEAKY
// The lookup also matched on full_name, and full names are already PUBLIC:
// landing_recent_hires is an anon RPC on the marketing page and returned 16 of
// them (hires plus their managers) at the time of the fix. Those 16 resolve to
// 21 profile rows holding 18 phone numbers and 21 email addresses. So the site
// published the seed list for its own contact-harvesting oracle, and the whole
// chain needed no account, no key and no rate limit.
//
// The name branch was ALSO unadvertised: the form's label is "Email or Phone"
// and its validator says "Email or phone is required". Nothing in the product
// asked for it, so it is deleted rather than narrowed — a branch no caller uses
// cannot be worth a disclosure this size.
//
// WHAT IS DELIBERATELY STILL RETURNED, AND WHY
// agentEmail survives because it is load-bearing, not because it is harmless:
// a phone-number login has to resolve to an address before the browser can call
// signInWithPassword. agentName survives because the next screen greets the
// agent by name. Both are the advertised feature. The residue is therefore
// "someone who knows an agent's real phone number can learn their name and
// email", which is a much smaller oracle than "someone who reads the homepage
// can", and closing it means moving the sign-in server-side — a change to Sam's
// login UX, so it is his call and is recorded rather than taken here.
//
// NOT ESCAPING-RELATED: the ilike() wildcards were already closed by MP-277 and
// re-proven here 5/5 against prod ("%", "*", "% %", "_am James", "%@gmail.com"
// all returned inCRM:false). This was never a bulk dump and is not reported as
// one.

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
    
    // No name branch: the form advertises "Email or Phone", and matching on
    // full_name is what let the public landing RPC's 16 names be turned into
    // 18 phone numbers and 21 addresses. Anything that is not a phone is
    // treated as an email and matched literally.
    console.log(`Checking status for identifier (isPhone: ${isPhone})`);

    let profile = null;
    let profileError = null;

    if (isPhone) {
      // Search by phone - try to match last 10 digits
      const last10 = digitsOnly.slice(-10);
      console.log(`Searching by phone, last 10 digits: ${last10}`);
      
      const { data, error } = await supabaseAdmin
        .from("profiles")
        .select("id, user_id, full_name, email")
        .or(`phone.ilike.%${last10}%`)
        .order("created_at", { ascending: false })
        .limit(1);
      
      profile = data?.[0] || null;
      profileError = error;
    } else {
      // Search by email
      const normalizedEmail = trimmedInput.toLowerCase();
      console.log(`Searching by email: ${normalizedEmail}`);
      
      const { data, error } = await supabaseAdmin
        .from("profiles")
        .select("id, user_id, full_name, email")
        .ilike("email", emailPattern(normalizedEmail))
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
    const agentEmail = profile?.email || null;
    const profileUserId = profile?.user_id || null;

    // Check if there's an auth user - OPTIMIZED: avoid heavy listUsers call
    let hasAuthAccount = false;
    
    if (inCRM && profileUserId) {
      // Check if the user_id is a real auth user (not a placeholder UUID)
      const isPlaceholderUUID = /^[a-f]1{7}-1{4}-1{4}-1{4}-1{12}$/i.test(profileUserId);
      
      if (!isPlaceholderUUID) {
        // Fast check: try to get user by ID directly
        const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.getUserById(profileUserId);
        hasAuthAccount = !authError && !!authUser?.user;
      }
    }

    console.log(`Status: inCRM=${inCRM}, hasAuthAccount=${hasAuthAccount}`);

    return new Response(
      JSON.stringify({
        // Exactly the four fields AgentNumbersLogin destructures. phone, city
        // and state were read by nobody and are gone; passwordRequired was read
        // by nobody and told a stranger about an account's state.
        inCRM,
        hasAuthAccount,
        agentName,
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
