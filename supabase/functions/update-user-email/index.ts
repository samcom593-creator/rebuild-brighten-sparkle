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

    // Use getClaims to verify JWT (works with signing-keys)
    const token = authHeader.replace("Bearer ", "");
    const anonClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: claimsData, error: claimsError } = await anonClient.auth.getClaims(token);

    if (claimsError || !claimsData?.claims) {
      console.error("Claims error:", claimsError);
      return new Response(
        JSON.stringify({ error: "Unauthorized - Invalid token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userId = claimsData.claims.sub as string;
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
    const { newEmail, targetUserId }: UpdateEmailRequest = await req.json();

    if (!newEmail || !newEmail.includes("@")) {
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
    console.log(`Updating email from ${oldEmail} to ${newEmail}`);

    // Check if the new email is the same as the current one
    if (oldEmail === newEmail) {
      return new Response(
        JSON.stringify({ error: "New email is the same as current email" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Update the email using Admin API (bypasses confirmation requirement)
    const { data: updateData, error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
      userIdToUpdate,
      { 
        email: newEmail,
        email_confirm: true // Mark as confirmed immediately
      }
    );

    if (updateError) {
      console.error("Error updating email:", updateError);
      return new Response(
        JSON.stringify({ error: updateError.message || "Failed to update email" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Auth email updated successfully for user:", userIdToUpdate);

    // Update the profiles table
    const { error: profileError } = await supabaseAdmin
      .from("profiles")
      .update({ email: newEmail })
      .eq("user_id", userIdToUpdate);

    if (profileError) {
      console.error("Error updating profile email:", profileError);
      // Don't fail the request, the auth email is already updated
    } else {
      console.log("Profile email updated successfully for user:", userIdToUpdate);
    }

    // Log the activity
    const { error: logError } = await supabaseAdmin
      .from("activity_logs")
      .insert({
        user_id: userId, // Who made the change
        action: targetUserId && targetUserId !== userId ? "admin_email_changed" : "email_changed",
        entity_type: "user",
        entity_id: userIdToUpdate, // Whose email was changed
        old_values: { email: oldEmail },
        new_values: { email: newEmail, changed_by: userId },
      });

    if (logError) {
      console.error("Error logging activity:", logError);
    }

    // Send notification emails
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (resendApiKey) {
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
      const sanitizedNewEmail = sanitizeHtml(newEmail);
      const sanitizedName = sanitizeHtml(userName);

      // Send alert to OLD email
      if (oldEmail) {
        try {
          const adminNote = isAdminChange ? "<p><em>This change was made by an administrator.</em></p>" : "";
          await resend.emails.send({
            from: "APEX Financial <notifications@tx.apex-financial.org>",
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
          from: "APEX Financial <notifications@tx.apex-financial.org>",
          to: [newEmail],
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
        console.log("Confirmation sent to new email:", newEmail);
      } catch (emailError) {
        console.error("Error sending confirmation to new email:", emailError);
      }
    } else {
      console.log("RESEND_API_KEY not configured, skipping email notifications");
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: "Email updated successfully",
        newEmail: newEmail
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
