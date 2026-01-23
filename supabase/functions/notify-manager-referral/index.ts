import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const resendApiKey = Deno.env.get("RESEND_API_KEY");

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

const resend = resendApiKey ? new Resend(resendApiKey) : null;

interface NotifyManagerReferralRequest {
  applicationId: string;
  managerId: string;
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

// Get manager info from agent ID - prioritizes auth.users email for accuracy
async function getManagerInfo(agentId: string): Promise<{ email: string; name: string } | null> {
  const { data: agent, error: agentError } = await supabaseAdmin
    .from("agents")
    .select("user_id")
    .eq("id", agentId)
    .maybeSingle();

  if (agentError || !agent?.user_id) {
    console.error("Error fetching agent:", agentError);
    return null;
  }

  // First try to get the canonical email from auth.users (most reliable source)
  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.getUserById(agent.user_id);
  
  if (!authError && authData?.user?.email) {
    // Get the name from profile
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("full_name")
      .eq("user_id", agent.user_id)
      .maybeSingle();
    
    console.log(`Using auth.users email for manager ${agentId}: ${authData.user.email}`);
    return {
      email: authData.user.email,
      name: profile?.full_name || "Manager",
    };
  }

  // Fallback to profile email if auth lookup fails
  const { data: profile, error: profileError } = await supabaseAdmin
    .from("profiles")
    .select("email, full_name")
    .eq("user_id", agent.user_id)
    .maybeSingle();

  if (profileError || !profile?.email) {
    console.error("Error fetching profile:", profileError);
    return null;
  }

  console.log(`Using profile email for manager ${agentId} (auth lookup failed): ${profile.email}`);
  return {
    email: profile.email,
    name: profile.full_name || "Manager",
  };
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { applicationId, managerId }: NotifyManagerReferralRequest = await req.json();

    if (!applicationId || !managerId) {
      return new Response(
        JSON.stringify({ error: "Missing applicationId or managerId" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    console.log(`Notifying manager ${managerId} about referral for application ${applicationId}`);

    // Get application details
    const { data: application, error: appError } = await supabaseAdmin
      .from("applications")
      .select("first_name, last_name, email, phone, license_status, city, state")
      .eq("id", applicationId)
      .maybeSingle();

    if (appError || !application) {
      console.error("Error fetching application:", appError);
      return new Response(
        JSON.stringify({ error: "Application not found" }),
        { status: 404, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Get manager info
    const managerInfo = await getManagerInfo(managerId);

    if (!managerInfo) {
      console.log("Manager info not found, skipping notification");
      return new Response(
        JSON.stringify({ success: true, skipped: true, reason: "Manager info not found" }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    if (!resend) {
      console.log("Resend not configured, skipping email");
      return new Response(
        JSON.stringify({ success: true, skipped: true, reason: "Email service not configured" }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Determine license status display
    const licenseStatusDisplay = application.license_status === "licensed" 
      ? "Licensed" 
      : application.license_status === "pending" 
        ? "License Pending" 
        : "Unlicensed";
    
    const licenseColor = application.license_status === "licensed" 
      ? "#10b981" 
      : application.license_status === "pending" 
        ? "#f59e0b" 
        : "#6b7280";

    const applicantName = `${sanitizeHtml(application.first_name)} ${sanitizeHtml(application.last_name)}`;
    const applicantLocation = application.city && application.state 
      ? `${sanitizeHtml(application.city)}, ${sanitizeHtml(application.state)}` 
      : "Not specified";

    // Send notification email
    const emailResponse = await resend.emails.send({
      from: "APEX Financial <applications@apex-financial.org>",
      to: [managerInfo.email],
      subject: `🎉 New Referral: ${applicantName} named you as their referrer!`,
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
              <h1 style="margin: 0; color: #0a0a0a; font-size: 24px; font-weight: 700;">You Have a New Referral! 🌟</h1>
            </div>
            <div style="padding: 30px;">
              <p style="color: #ffffff; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                Hi ${sanitizeHtml(managerInfo.name)},
              </p>
              <p style="color: #a0aec0; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                Great news! Someone just applied to APEX Financial and selected you as their referrer. This lead has been automatically assigned to you.
              </p>
              <div style="background: rgba(212, 175, 55, 0.1); border: 1px solid rgba(212, 175, 55, 0.3); border-radius: 12px; padding: 20px; margin: 20px 0;">
                <h3 style="color: #d4af37; margin: 0 0 15px 0; font-size: 14px; text-transform: uppercase; letter-spacing: 1px;">Applicant Details</h3>
                <table style="width: 100%; border-collapse: collapse;">
                  <tr>
                    <td style="color: #a0aec0; padding: 8px 0; font-size: 14px;">Name:</td>
                    <td style="color: #ffffff; padding: 8px 0; font-size: 14px; font-weight: 600;">${applicantName}</td>
                  </tr>
                  <tr>
                    <td style="color: #a0aec0; padding: 8px 0; font-size: 14px;">Email:</td>
                    <td style="color: #ffffff; padding: 8px 0; font-size: 14px;">${sanitizeHtml(application.email)}</td>
                  </tr>
                  <tr>
                    <td style="color: #a0aec0; padding: 8px 0; font-size: 14px;">Phone:</td>
                    <td style="color: #ffffff; padding: 8px 0; font-size: 14px;">${sanitizeHtml(application.phone)}</td>
                  </tr>
                  <tr>
                    <td style="color: #a0aec0; padding: 8px 0; font-size: 14px;">Location:</td>
                    <td style="color: #ffffff; padding: 8px 0; font-size: 14px;">${applicantLocation}</td>
                  </tr>
                  <tr>
                    <td style="color: #a0aec0; padding: 8px 0; font-size: 14px;">License Status:</td>
                    <td style="padding: 8px 0;">
                      <span style="background: ${licenseColor}20; color: ${licenseColor}; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600;">
                        ${licenseStatusDisplay}
                      </span>
                    </td>
                  </tr>
                </table>
              </div>
              <p style="color: #a0aec0; font-size: 14px; line-height: 1.6; margin: 20px 0;">
                Log in to your dashboard to view this lead and follow up.
              </p>
              <div style="text-align: center; margin-top: 30px;">
                <a href="https://rebuild-brighten-sparkle.lovable.app/dashboard" style="display: inline-block; background: linear-gradient(135deg, #d4af37 0%, #f4d03f 100%); color: #0a0a0a; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600; font-size: 14px;">
                  View in Dashboard →
                </a>
              </div>
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

    console.log("Manager referral notification email sent:", emailResponse);

    return new Response(
      JSON.stringify({ success: true, emailId: emailResponse.data?.id }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error) {
    console.error("notify-manager-referral error:", error);
    return new Response(
      JSON.stringify({ error: "Server error" }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);
