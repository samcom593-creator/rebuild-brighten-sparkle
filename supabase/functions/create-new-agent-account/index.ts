import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { emailPattern } from "../_shared/like-escape.ts";
import { resolveOne } from "../_shared/resolve-one.ts";
import { findAuthUserByEmail } from "../_shared/find-auth-user.ts";

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

    const { email, fullName, phone, licenseStatus, managerId } = await req.json();

    if (!email || !fullName) {
      throw new Error("Email and full name are required");
    }

    const normalizedEmail = email.toLowerCase().trim();
    console.log(`Creating new agent account for: ${normalizedEmail}`);

    // Check if email already exists in profiles.
    //
    // This read is the reason duplicates exist. It used to be
    // .ilike("email", normalizedEmail).maybeSingle(), which fails in two ways at
    // once: the raw email is a LIKE pattern (a lookup for j_intwan@yahoo.com
    // returns j.intwan@yahoo.com — a different person), and .maybeSingle()
    // returns null when the filter matches more than one row. Both land on
    // `existingProfile == null`, which this function reads as "nobody has this
    // email" and answers by creating another account. profiles.email carries no
    // unique index and has 8 colliding keys / 16 rows live, so the failure was
    // self-amplifying: every duplicate it created made the next collision likelier.
    const existing = await resolveOne<{ id: string; user_id: string }>(
      supabaseAdmin
        .from("profiles")
        .select("id, user_id")
        .ilike("email", emailPattern(normalizedEmail)),
      { label: `profiles.email=${normalizedEmail}` },
    );
    const existingProfile = existing.row;

    // Ambiguity means the person exists at least twice. Returning one of their
    // ids is right — creating a third row is not. The merge is Sam's call in
    // /admin/agent-duplicates; this only refuses to make it worse.
    if (existing.ambiguous) {
      console.warn(
        `[create-new-agent-account] ${normalizedEmail} matches ${existing.matched} profiles; ` +
          `returning the first and NOT creating another. Needs a merge.`,
      );
    }

    if (existingProfile) {
      // Return existing user_id if profile exists
      console.log(`Profile already exists for ${normalizedEmail}, returning existing user_id`);
      return new Response(
        JSON.stringify({ 
          userId: existingProfile.user_id,
          profileId: existingProfile.id,
          existed: true 
        }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Check if auth user already exists. Pages until found or the table ends —
    // the previous single page of 1000 was 469 rows of headroom away from
    // silently reporting "no such account" for someone who has one.
    const authLookup = await findAuthUserByEmail(supabaseAdmin, normalizedEmail);
    const existingAuthUser = authLookup.user;

    if (existingAuthUser) {
      console.log(`Auth user already exists for ${normalizedEmail}`);
      // Create profile and agent for existing auth user
      const { data: newProfile, error: profileError } = await supabaseAdmin
        .from("profiles")
        .insert({
          user_id: existingAuthUser.id,
          email: normalizedEmail,
          full_name: fullName,
          phone: phone || null,
        })
        .select("id")
        .single();

      if (profileError) {
        console.error("Error creating profile for existing auth user:", profileError);
        throw new Error("Failed to create profile");
      }

      return new Response(
        JSON.stringify({ 
          userId: existingAuthUser.id,
          profileId: newProfile.id,
          existed: true 
        }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Create new auth user with default password (agents change on first login)
    const randomPassword = "123456";
    
    const { data: newAuthUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: normalizedEmail,
      password: randomPassword,
      email_confirm: true, // Skip email confirmation
      user_metadata: {
        full_name: fullName,
      },
    });

    if (createError || !newAuthUser?.user) {
      console.error("Error creating auth user:", createError);
      throw new Error("Failed to create auth account");
    }

    const userId = newAuthUser.user.id;
    console.log(`Created auth user: ${userId}`);

    // Delete the trigger-created profile (if any) to avoid conflicts
    await supabaseAdmin
      .from("profiles")
      .delete()
      .eq("user_id", userId);

    // Delete the trigger-created role (if any) to avoid duplicates
    await supabaseAdmin
      .from("user_roles")
      .delete()
      .eq("user_id", userId);

    // Create profile record
    const { data: newProfile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .insert({
        user_id: userId,
        email: normalizedEmail,
        full_name: fullName,
        phone: phone || null,
      })
      .select("id")
      .single();

    if (profileError) {
      console.error("Error creating profile:", profileError);
      // Clean up the auth user if profile creation fails
      await supabaseAdmin.auth.admin.deleteUser(userId);
      throw new Error("Failed to create profile");
    }

    console.log(`Created profile: ${newProfile.id}`);

    // Add agent role
    const { error: roleError } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: userId, role: "agent" });

    if (roleError) {
      console.error("Error adding agent role:", roleError);
    }

    return new Response(
      JSON.stringify({ 
        userId: userId,
        profileId: newProfile.id,
        existed: false 
      }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: any) {
    console.error("Error in create-new-agent-account:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);
