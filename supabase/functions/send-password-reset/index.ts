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

    console.log(`Sending password reset to: ${email}`);

    // Generate password reset link
    const { data, error } = await supabaseAdmin.auth.admin.generateLink({
      type: "recovery",
      email: email,
    });

    if (error) {
      console.error("Error generating reset link:", error);
      throw error;
    }

    // Send the email via Resend
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) {
      throw new Error("RESEND_API_KEY not configured");
    }

    const resetLink = data.properties?.action_link;
    
    const emailResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${resendApiKey}`,
      },
      body: JSON.stringify({
        from: "APEX Financial <noreply@apex-financial.org>",
        to: [email],
        subject: "Reset Your Password - APEX Financial",
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
                    🔐 Password Reset
                  </h1>
                  <p style="margin: 8px 0 0; color: rgba(255,255,255,0.9); font-size: 14px;">
                    APEX Financial
                  </p>
                </div>
                
                <!-- Content -->
                <div style="padding: 40px 30px; color: #e4e4e7;">
                  <p style="font-size: 18px; margin: 0 0 20px; line-height: 1.6;">
                    Hey there! 👋
                  </p>
                  
                  <p style="font-size: 16px; margin: 0 0 30px; line-height: 1.6; color: #a1a1aa;">
                    You requested a password reset for your APEX Financial account. Click the button below to set a new password:
                  </p>
                  
                  <div style="text-align: center; margin: 35px 0;">
                    <a href="${resetLink}" style="display: inline-block; background: linear-gradient(135deg, #8b5cf6 0%, #a855f7 100%); color: #ffffff; text-decoration: none; padding: 16px 40px; border-radius: 50px; font-weight: 700; font-size: 16px; box-shadow: 0 4px 15px rgba(139, 92, 246, 0.4);">
                      Reset My Password
                    </a>
                  </div>
                  
                  <p style="font-size: 14px; margin: 30px 0 0; line-height: 1.6; color: #71717a; text-align: center;">
                    This link will expire in 1 hour. If you didn't request this reset, you can safely ignore this email.
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

    console.log("Password reset email sent successfully");

    return new Response(
      JSON.stringify({ success: true, message: "Password reset email sent" }),
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

serve(handler);
