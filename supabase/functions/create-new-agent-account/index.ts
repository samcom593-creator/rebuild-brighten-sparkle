import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { emailPattern } from "../_shared/like-escape.ts";
import { resolveOne } from "../_shared/resolve-one.ts";
import { findAuthUserByEmail, type AuthUserLister } from "../_shared/find-auth-user.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// §8 APEX OS redesign (2026-10-06). This function used to read NO credential
// (verify_jwt = false) and created a CONFIRMED login with the fixed password
// "123456" for any address POSTed to it, then answered {existed:true, 200} for
// a person already on file, which its only in-app caller (InviteTeamModal)
// treated as licence to insert a second agents row. Invite Team now mints an
// invitation instead (create_invitation → /hire/:token → consume-invite-token),
// so this endpoint is admin/manager-only, never sets a known password, and
// refuses an existing person with 409 instead of handing back their ids.
function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

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

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Unauthorized" }, 401);
    }
    const { data: caller, error: callerError } = await supabaseAdmin.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (callerError || !caller?.user) {
      return json({ error: "Invalid token" }, 401);
    }
    const { data: callerRoles, error: rolesError } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", caller.user.id);
    if (rolesError) {
      return json({ error: "Permission check could not be completed." }, 500);
    }
    if (!(callerRoles ?? []).some((r: { role: string }) => r.role === "admin" || r.role === "manager")) {
      return json({ error: "Permission denied. Only admins and managers can create agent accounts." }, 403);
    }

    const { email, fullName, phone } = await req.json();

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
      // A person already on file is a refusal, not a success to build on.
      console.log(`Profile already exists for ${normalizedEmail}; refusing to create another`);
      return json({ error: `An account for ${normalizedEmail} already exists.`, existed: true }, 409);
    }

    // Check if auth user already exists. Pages until found or the table ends —
    // the previous single page of 1000 was 469 rows of headroom away from
    // silently reporting "no such account" for someone who has one.
    const authLookup = await findAuthUserByEmail(supabaseAdmin as unknown as AuthUserLister, normalizedEmail);
    if (!authLookup.exhaustive) {
      throw new Error("Account lookup could not be completed. No account was created; please retry.");
    }
    const existingAuthUser = authLookup.user;

    if (existingAuthUser) {
      // A login with no profile: repair the profile, but never mint an agents
      // row here and never report the person as new.
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

    // Unguessable password nobody is told; the agent signs in by magic link or
    // the reset flow. A fixed shared password made every account it created
    // takeover-able by anyone who knew the address.
    const pwBytes = new Uint8Array(24);
    crypto.getRandomValues(pwBytes);
    const randomPassword = Array.from(pwBytes, (b) => b.toString(36).padStart(2, "0")).join("") + "Aa1!";
    
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
