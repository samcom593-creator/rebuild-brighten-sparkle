import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

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
    console.log(`Processing password reset for: ${normalizedEmail}`);

    // Check if email exists in CRM (profiles table)
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("id, user_id, full_name")
      .ilike("email", normalizedEmail)
      .maybeSingle();

    // Check if auth user exists
    const { data: authUsers } = await supabaseAdmin.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    
    const authUser = authUsers?.users?.find(
      (u) => u.email?.toLowerCase() === normalizedEmail
    );

    // Case 1: Auth user exists - send standard password reset
    if (authUser) {
      console.log(`Auth user found, sending standard password reset`);
      
      const { data, error } = await supabaseAdmin.auth.admin.generateLink({
        type: "recovery",
        email: normalizedEmail,
        options: {
          redirectTo: "https://apex-financial.org/apex-daily-numbers",
        },
      });

      if (error) {
        console.error("Error generating reset link:", error);
        throw new Error("Failed to generate reset link. Please try again.");
      }

      const resetLink = data.properties?.action_link;
      await sendResetEmail(normalizedEmail, resetLink, profile?.full_name || "Agent", "reset");
      
      return new Response(
        JSON.stringify({ success: true, message: "Password reset email sent" }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Case 2: No auth user but email in CRM - send "set up your password" email
    if (profile) {
      console.log(`CRM user without auth account, sending setup email`);
      
      // Generate a magic link for them to set up their password
      // We'll direct them to the login page with a special flag
      const setupLink = `https://apex-financial.org/agent-login?setup=true&email=${encodeURIComponent(normalizedEmail)}`;
      
      await sendResetEmail(normalizedEmail, setupLink, profile.full_name || "Agent", "setup");
      
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: "Password setup email sent",
          isSetup: true 
        }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Case 3: Email not found anywhere
    console.log(`Email not found in system: ${normalizedEmail}`);
    
    // For security, we still return success (don't reveal if email exists)
    // But we don't send an email
    return new Response(
      JSON.stringify({ success: true, message: "If this email exists, a reset link has been sent" }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );

  } catch (error: any) {
    console.error("Error in send-password-reset:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

async function sendResetEmail(email: string, link: string, name: string, type: "reset" | "setup") {
  if (!RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY not configured");
  }

  const isSetup = type === "setup";
  const subject = isSetup 
    ? "Set Up Your APEX Daily Numbers Password" 
    : "Reset Your Password - APEX Financial";
  
  const heading = isSetup ? "🔑 Set Up Your Password" : "🔐 Password Reset";
  const message = isSetup
    ? "Your APEX Daily Numbers account is ready! Click the button below to set your password and start logging your production:"
    : "You requested a password reset for your APEX Financial account. Click the button below to set a new password:";
  const buttonText = isSetup ? "Set My Password" : "Reset My Password";

  const emailResponse = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: "APEX Financial <noreply@apex-financial.org>",
      to: [email],
      subject: subject,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #0a0a0b;">
          <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
            <div style="background: linear-gradient(135deg, #18181b 0%, #1c1c1f 100%); border-radius: 16px; overflow: hidden; box-shadow: 0 20px 40px rgba(0,0,0,0.3); border: 1px solid rgba(139, 92, 246, 0.2);">
              
              <!-- Header -->
              <div style="background: linear-gradient(135deg, #8b5cf6 0%, #a855f7 50%, #f59e0b 100%); padding: 30px; text-align: center;">
                <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 700;">
                  ${heading}
                </h1>
                <p style="margin: 8px 0 0; color: rgba(255,255,255,0.9); font-size: 14px;">
                  APEX Financial
                </p>
              </div>
              
              <!-- Content -->
              <div style="padding: 40px 30px; color: #e4e4e7;">
                <p style="font-size: 18px; margin: 0 0 20px; line-height: 1.6;">
                  Hey ${name}! 👋
                </p>
                
                <p style="font-size: 16px; margin: 0 0 30px; line-height: 1.6; color: #a1a1aa;">
                  ${message}
                </p>
                
                <div style="text-align: center; margin: 35px 0;">
                  <a href="${link}" style="display: inline-block; background: linear-gradient(135deg, #8b5cf6 0%, #a855f7 100%); color: #ffffff; text-decoration: none; padding: 16px 40px; border-radius: 50px; font-weight: 700; font-size: 16px; box-shadow: 0 4px 15px rgba(139, 92, 246, 0.4);">
                    ${buttonText}
                  </a>
                </div>
                
                <p style="font-size: 14px; margin: 30px 0 0; line-height: 1.6; color: #71717a; text-align: center;">
                  This link will expire in 1 hour. If you didn't request this, you can safely ignore this email.
                </p>
              </div>
              
              <!-- Footer -->
              <div style="background: rgba(0,0,0,0.3); padding: 20px 30px; text-align: center; border-top: 1px solid rgba(139, 92, 246, 0.1);">
                <p style="margin: 0; font-size: 12px; color: #71717a;">
                  APEX Financial • Daily Production Tracker
                </p>
              </div>
              
            </div>
          </div>
        </body>
        </html>
      `,
    }),
  });

  if (!emailResponse.ok) {
    const errorData = await emailResponse.text();
    console.error("Resend error:", errorData);
    throw new Error(`Failed to send email: ${errorData}`);
  }

  console.log(`${type} email sent successfully to ${email}`);
}

serve(handler);
