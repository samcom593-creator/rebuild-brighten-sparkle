import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } }
);

interface UpdateEmailRequest {
  newEmail: string;
  targetUserId?: string; // Optional: Admin can change email for another user
  fullName?: string;
}

function sanitizeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

const handler = async (req: Request): Promise<Response> => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Get the authorization header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Unauthorized - No valid token provided" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify the JWT token using getUser
    const token = authHeader.replace("Bearer ", "");
    const { data: { user: authUser }, error: userError } = await supabaseAdmin.auth.getUser(token);

    if (userError || !authUser) {
      console.error("Auth error:", userError);
      return new Response(
        JSON.stringify({ error: "Unauthorized - Invalid token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userId = authUser.id;
    console.log("Processing email update for user:", userId);

    // Verify the user has manager or admin role
    const { data: roles, error: rolesError } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);

    if (rolesError) {
      console.error("Error fetching roles:", rolesError);
      return new Response(
        JSON.stringify({ error: "Failed to verify user role" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userRoles = roles?.map((r) => r.role) || [];
    const isManager = userRoles.includes("manager");
    const isAdmin = userRoles.includes("admin");
    const isManagerOrAdmin = isManager || isAdmin;

    if (!isManagerOrAdmin) {
      return new Response(
        JSON.stringify({ error: "Only managers and admins can use direct email update" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse request body
    const { newEmail, targetUserId, fullName }: UpdateEmailRequest = await req.json();
    const normalizedEmail = typeof newEmail === "string" ? newEmail.trim().toLowerCase() : "";
    const normalizedName = typeof fullName === "string" ? fullName.trim().slice(0, 120) : "";

    if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return new Response(
        JSON.stringify({ error: "Valid email address is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Determine whose email to change
    let userIdToUpdate = userId;
    
    // If targetUserId is provided, only admins can change another user's email
    if (targetUserId && targetUserId !== userId) {
      if (!isAdmin) {
        return new Response(
          JSON.stringify({ error: "Only admins can change another user's email" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      userIdToUpdate = targetUserId;
      console.log(`Admin ${userId} is changing email for user ${targetUserId}`);
    }

    // Get the target user's current email before updating
    const { data: currentUserData, error: currentUserError } = await supabaseAdmin.auth.admin.getUserById(userIdToUpdate);
    
    if (currentUserError || !currentUserData?.user) {
      console.error("Error fetching target user:", currentUserError);
      return new Response(
        JSON.stringify({ error: "Failed to fetch user data" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const oldEmail = currentUserData.user.email;
    console.log(`Updating account email for user ${userIdToUpdate}`);

    const authEmailChanged = oldEmail?.trim().toLowerCase() !== normalizedEmail;

    // Update the auth identity only when it actually changed. A same-email call
    // is still useful: it repairs the legacy role-without-profile state below.
    if (authEmailChanged) {
      const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
        userIdToUpdate,
        {
          email: normalizedEmail,
          email_confirm: true,
        }
      );

      if (updateError) {
        console.error("Error updating email:", updateError);
        return new Response(
          JSON.stringify({ error: updateError.message || "Failed to update email" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    console.log("Auth email updated successfully for user:", userIdToUpdate);

    // UPSERT, not UPDATE. One live legacy login has a role but no profile; an
    // UPDATE affects zero rows and the old function still returned success,
    // leaving every account screen blank forever.
    const profileName = normalizedName
      || String(currentUserData.user.user_metadata?.full_name ?? "").trim().slice(0, 120)
      || null;
    const { error: profileError } = await supabaseAdmin
      .from("profiles")
      .upsert({
        user_id: userIdToUpdate,
        email: normalizedEmail,
        ...(profileName ? { full_name: profileName } : {}),
      }, { onConflict: "user_id" });

    if (profileError) {
      console.error("Error updating profile email:", profileError);
      // Do not claim success with auth and profile disagreeing. Roll auth back
      // when possible; if rollback also fails, report the partial state loudly.
      if (authEmailChanged && oldEmail) {
        const { error: rollbackError } = await supabaseAdmin.auth.admin.updateUserById(
          userIdToUpdate,
          { email: oldEmail, email_confirm: true },
        );
        if (rollbackError) {
          console.error("CRITICAL: profile sync and auth rollback both failed", rollbackError);
          return new Response(
            JSON.stringify({ error: "Auth email changed but profile synchronization failed; administrator repair required" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
      }
      return new Response(
        JSON.stringify({ error: "Profile synchronization failed; no account change was kept" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    console.log("Profile email synchronized successfully for user:", userIdToUpdate);

    // Log the activity
    const { error: logError } = await supabaseAdmin
      .from("activity_logs")
      .insert({
        user_id: userId, // Who made the change
        action: authEmailChanged
          ? (targetUserId && targetUserId !== userId ? "admin_email_changed" : "email_changed")
          : "account_profile_repaired",
        entity_type: "user",
        entity_id: userIdToUpdate, // Whose email was changed
        old_values: { email: oldEmail },
        new_values: { email: normalizedEmail, changed_by: userId },
      });

    if (logError) {
      console.error("Error logging activity:", logError);
    }

    // Send notification emails
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (resendApiKey && authEmailChanged) {
      const resend = new Resend(resendApiKey);

      // Get target user's name for the email
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("full_name")
        .eq("user_id", userIdToUpdate)
        .single();

      const userName = profile?.full_name || "Team Member";
      const isAdminChange = targetUserId && targetUserId !== userId;
      const sanitizedOldEmail = sanitizeHtml(oldEmail || "");
      const sanitizedNewEmail = sanitizeHtml(normalizedEmail);
      const sanitizedName = sanitizeHtml(userName);

      // Send alert to OLD email
      if (oldEmail) {
        try {
          const adminNote = isAdminChange ? "<p><em>This change was made by an administrator.</em></p>" : "";
          await resend.emails.send({
             from: "APEX Financial <notifications@apex-financial.org>",
            to: [oldEmail],
            subject: "Security Alert: Your APEX Financial email has been changed",
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h1 style="color: #1a1a1a;">Security Alert</h1>
                <p>Hi ${sanitizedName},</p>
                <p>Your email address for APEX Financial has been changed.</p>
                <div style="background-color: #f8f9fa; padding: 16px; border-radius: 8px; margin: 24px 0;">
                  <p style="margin: 0;"><strong>Previous email:</strong> ${sanitizedOldEmail}</p>
                  <p style="margin: 8px 0 0 0;"><strong>New email:</strong> ${sanitizedNewEmail}</p>
                </div>
                ${adminNote}
                <p style="color: #dc2626;"><strong>If you did not make this change, please contact support immediately.</strong></p>
                <p>Best regards,<br>The APEX Financial Team</p>
              </div>
            `,
          });
          console.log("Alert sent to old email:", oldEmail);
        } catch (emailError) {
          console.error("Error sending alert to old email:", emailError);
        }
      }

      // Send confirmation to NEW email
      try {
        await resend.emails.send({
          from: "APEX Financial <notifications@apex-financial.org>",
          to: [normalizedEmail],
          subject: "Welcome! Your APEX Financial email has been updated",
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h1 style="color: #1a1a1a;">Email Updated Successfully</h1>
              <p>Hi ${sanitizedName},</p>
              <p>Your email address has been successfully updated to <strong>${sanitizedNewEmail}</strong>.</p>
              <p>You can now use this email address to log in to your APEX Financial account.</p>
              <p>Best regards,<br>The APEX Financial Team</p>
            </div>
          `,
        });
        console.log("Confirmation sent to new email");
      } catch (emailError) {
        console.error("Error sending confirmation to new email:", emailError);
      }
    } else if (!resendApiKey && authEmailChanged) {
      console.log("RESEND_API_KEY not configured, skipping email notifications");
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: "Email updated successfully",
        newEmail: normalizedEmail,
        profileSynchronized: true,
      }),
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
