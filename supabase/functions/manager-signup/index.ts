import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface SignupRequest {
  token: string;
  email: string;
  password: string;
  fullName: string;
}

// Helper to sanitize HTML
function sanitizeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    
    // Use service role client for admin operations
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
    const resend = resendApiKey ? new Resend(resendApiKey) : null;
    
    const { token, email, password, fullName }: SignupRequest = await req.json();

    // Validate required fields
    if (!token || !email || !password || !fullName) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return new Response(
        JSON.stringify({ error: "Invalid email format" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate password length
    if (password.length < 6) {
      return new Response(
        JSON.stringify({ error: "Password must be at least 6 characters" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate token - server-side validation with service role
    const { data: tokenData, error: tokenError } = await supabaseAdmin
      .from("manager_signup_tokens")
      .select("id, manager_name, manager_email, is_used, expires_at, created_by")
      .eq("token", token)
      .single();

    if (tokenError || !tokenData) {
      console.error("Token validation error:", tokenError);
      return new Response(
        JSON.stringify({ error: "Invalid invite token" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (tokenData.is_used) {
      return new Response(
        JSON.stringify({ error: "This invite link has already been used" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (new Date(tokenData.expires_at) < new Date()) {
      return new Response(
        JSON.stringify({ error: "This invite link has expired" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create the auth account using admin client
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // Auto-confirm since they have a valid token
      user_metadata: {
        full_name: fullName,
      },
    });

    if (authError) {
      console.error("Auth creation error:", authError);
      if (authError.message?.includes("already been registered")) {
        return new Response(
          JSON.stringify({ error: "This email is already registered. Please log in instead." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({ error: authError.message || "Failed to create account" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userId = authData.user.id;

    // Create agent record with active status (pre-approved via token)
    const { error: agentError } = await supabaseAdmin
      .from("agents")
      .insert({
        user_id: userId,
        status: "active",
        license_status: "unlicensed",
        verified_at: new Date().toISOString(),
        verified_by: tokenData.created_by,
      });

    if (agentError) {
      console.error("Agent creation error:", agentError);
      // Continue anyway - trigger may have created it
    }

    // Delete the default 'agent' role assigned by trigger and add 'manager' role
    // The trigger handle_new_user() assigns 'agent' by default
    await supabaseAdmin
      .from("user_roles")
      .delete()
      .eq("user_id", userId)
      .eq("role", "agent");

    const { error: roleError } = await supabaseAdmin
      .from("user_roles")
      .insert({
        user_id: userId,
        role: "manager",
      });

    if (roleError) {
      console.error("Role assignment error:", roleError);
      // This is critical - rollback by deleting the user
      await supabaseAdmin.auth.admin.deleteUser(userId);
      return new Response(
        JSON.stringify({ error: "Failed to assign manager role" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Mark token as used
    const { error: tokenUpdateError } = await supabaseAdmin
      .from("manager_signup_tokens")
      .update({
        is_used: true,
        used_at: new Date().toISOString(),
        used_by: userId,
      })
      .eq("id", tokenData.id);

    if (tokenUpdateError) {
      console.error("Token update error:", tokenUpdateError);
      // Non-critical, continue
    }

    // Log the activity
    await supabaseAdmin
      .from("activity_logs")
      .insert({
        user_id: userId,
        action: "manager_signup_completed",
        entity_type: "user",
        entity_id: userId,
        details: {
          email,
          full_name: fullName,
          token_id: tokenData.id,
          created_by: tokenData.created_by,
        },
      });

    console.log(`Manager account created successfully for ${email}`);

    // Send email notification to the admin who created the invite
    if (resend && tokenData.created_by) {
      try {
        // Get the admin's email
        const { data: adminProfile } = await supabaseAdmin
          .from("profiles")
          .select("email, full_name")
          .eq("user_id", tokenData.created_by)
          .maybeSingle();

        if (adminProfile?.email) {
          const safeName = sanitizeHtml(fullName);
          const safeEmail = sanitizeHtml(email);
          const adminName = adminProfile.full_name || "Admin";

          await resend.emails.send({
            from: "APEX Financial <notifications@apex-financial.org>",
            to: [adminProfile.email],
            subject: "🎉 New Manager Account Created",
            html: `
              <!DOCTYPE html>
              <html>
              <head>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
              </head>
              <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #0a0a0a; margin: 0; padding: 20px;">
                <div style="max-width: 600px; margin: 0 auto; background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); border-radius: 16px; overflow: hidden; border: 1px solid rgba(212, 175, 55, 0.3);">
                  <div style="background: linear-gradient(135deg, #d4af37 0%, #f4d03f 100%); padding: 30px; text-align: center;">
                    <h1 style="margin: 0; color: #0a0a0a; font-size: 24px; font-weight: 700;">New Manager Account Created! 🎉</h1>
                  </div>
                  <div style="padding: 30px;">
                    <p style="color: #ffffff; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                      Hi ${sanitizeHtml(adminName)},
                    </p>
                    <p style="color: #a0aec0; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                      Great news! A new manager has successfully created their account using an invite link you generated.
                    </p>
                    <div style="background: rgba(212, 175, 55, 0.1); border: 1px solid rgba(212, 175, 55, 0.3); border-radius: 12px; padding: 20px; margin: 20px 0;">
                      <h3 style="color: #d4af37; margin: 0 0 15px 0; font-size: 14px; text-transform: uppercase; letter-spacing: 1px;">New Manager Details</h3>
                      <table style="width: 100%; border-collapse: collapse;">
                        <tr>
                          <td style="color: #a0aec0; padding: 8px 0; font-size: 14px;">Name:</td>
                          <td style="color: #ffffff; padding: 8px 0; font-size: 14px; font-weight: 600;">${safeName}</td>
                        </tr>
                        <tr>
                          <td style="color: #a0aec0; padding: 8px 0; font-size: 14px;">Email:</td>
                          <td style="color: #ffffff; padding: 8px 0; font-size: 14px;">${safeEmail}</td>
                        </tr>
                        <tr>
                          <td style="color: #a0aec0; padding: 8px 0; font-size: 14px;">Created:</td>
                          <td style="color: #ffffff; padding: 8px 0; font-size: 14px;">${new Date().toLocaleString()}</td>
                        </tr>
                      </table>
                    </div>
                    <p style="color: #a0aec0; font-size: 14px; line-height: 1.6; margin: 20px 0 0 0;">
                      They can now log in and start managing their team.
                    </p>
                  </div>
                  <div style="background: rgba(0, 0, 0, 0.3); padding: 20px; text-align: center; border-top: 1px solid rgba(212, 175, 55, 0.2);">
                    <p style="color: #666; font-size: 12px; margin: 0;">
                      © ${new Date().getFullYear()} APEX Financial. All rights reserved.
                    </p>
                  </div>
                </div>
              </body>
              </html>
            `,
          });
          console.log(`Admin notification email sent to ${adminProfile.email}`);
        }
      } catch (emailError) {
        console.error("Failed to send admin notification email:", emailError);
        // Non-critical, don't fail the signup
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: "Account created successfully",
        userId 
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Manager signup error:", error);
    return new Response(
      JSON.stringify({ error: "An unexpected error occurred" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
