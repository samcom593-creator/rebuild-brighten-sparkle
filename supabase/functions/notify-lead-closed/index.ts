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

interface NotifyLeadClosedRequest {
  applicationId: string;
  agentId: string;
}

// Get manager info by agent ID - prioritizes auth.users email for accuracy
async function getManagerInfo(agentId: string): Promise<{ email: string; name: string } | null> {
  try {
    const { data: agent, error: agentError } = await supabaseAdmin
      .from("agents")
      .select("user_id")
      .eq("id", agentId)
      .single();
    
    if (agentError || !agent?.user_id) {
      console.log("Could not find agent:", agentError);
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
        name: profile?.full_name || authData.user.email.split("@")[0],
      };
    }
    
    // Fallback to profile email if auth lookup fails
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("email, full_name")
      .eq("user_id", agent.user_id)
      .single();
    
    if (profileError || !profile?.email) {
      console.log("Could not find profile:", profileError);
      return null;
    }
    
    console.log(`Using profile email for manager ${agentId} (auth lookup failed): ${profile.email}`);
    return {
      email: profile.email,
      name: profile.full_name || profile.email.split("@")[0],
    };
  } catch (err) {
    console.error("Error getting manager info:", err);
    return null;
  }
}

// Sanitize string for HTML
function sanitizeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

const handler = async (req: Request): Promise<Response> => {
  console.log("notify-lead-closed: Received request");
  
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { applicationId, agentId }: NotifyLeadClosedRequest = await req.json();
    
    if (!applicationId || !agentId) {
      return new Response(
        JSON.stringify({ error: "Missing applicationId or agentId" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    console.log(`Processing closed lead notification for app ${applicationId}, agent ${agentId}`);

    // Get application details
    const { data: app, error: appError } = await supabaseAdmin
      .from("applications")
      .select("first_name, last_name, email, city, state, license_status")
      .eq("id", applicationId)
      .single();

    if (appError || !app) {
      console.error("Could not find application:", appError);
      return new Response(
        JSON.stringify({ error: "Application not found" }),
        { status: 404, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Get manager info
    const managerInfo = await getManagerInfo(agentId);
    
    if (!managerInfo) {
      console.log("No manager info found, skipping notification");
      return new Response(
        JSON.stringify({ success: true, skipped: true, reason: "No manager email found" }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    if (!resend) {
      console.warn("RESEND_API_KEY not configured, skipping email");
      return new Response(
        JSON.stringify({ success: true, skipped: true, reason: "Email not configured" }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const sanitized = {
      firstName: sanitizeHtml(app.first_name),
      lastName: sanitizeHtml(app.last_name),
      email: sanitizeHtml(app.email),
      city: sanitizeHtml(app.city || "Unknown"),
      state: sanitizeHtml(app.state || ""),
    };

    const licenseStatusMap: Record<string, string> = {
      licensed: "Licensed",
      unlicensed: "Not Yet Licensed",
      pending: "License Pending",
    };
    const licenseStatusDisplay = licenseStatusMap[app.license_status] || app.license_status;

    // Send celebration email to manager
    const emailResponse = await resend.emails.send({
      from: "APEX Notifications <noreply@apex-financial.org>",
      to: [managerInfo.email],
      subject: `🎉 Lead Closed: ${sanitized.firstName} ${sanitized.lastName}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #10b981, #059669); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 28px;">🎉 Congratulations!</h1>
            <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0; font-size: 18px;">You closed a deal!</p>
          </div>
          
          <div style="background: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px;">
            <h2 style="color: #111827; margin-top: 0;">Hi ${managerInfo.name},</h2>
            
            <p style="color: #4b5563; line-height: 1.6;">
              Great work! You've successfully closed the following lead:
            </p>

            <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border: 1px solid #e5e7eb;">
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; color: #6b7280; width: 40%;">Name:</td>
                  <td style="padding: 8px 0; font-weight: bold;">${sanitized.firstName} ${sanitized.lastName}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #6b7280;">Email:</td>
                  <td style="padding: 8px 0;"><a href="mailto:${app.email}" style="color: #059669;">${sanitized.email}</a></td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #6b7280;">Location:</td>
                  <td style="padding: 8px 0;">${sanitized.city}, ${sanitized.state}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #6b7280;">License Status:</td>
                  <td style="padding: 8px 0;">
                    <span style="background: ${app.license_status === 'licensed' ? '#d1fae5' : app.license_status === 'pending' ? '#fef3c7' : '#fee2e2'}; 
                                 color: ${app.license_status === 'licensed' ? '#047857' : app.license_status === 'pending' ? '#92400e' : '#991b1b'};
                                 padding: 4px 12px; border-radius: 20px; font-size: 14px; font-weight: 500;">
                      ${licenseStatusDisplay}
                    </span>
                  </td>
                </tr>
              </table>
            </div>

            <div style="background: #d1fae5; border-left: 4px solid #10b981; padding: 15px 20px; margin: 20px 0; border-radius: 0 8px 8px 0;">
              <p style="margin: 0; color: #047857; font-weight: 500;">
                Keep up the great work! Your dedication is paying off. 💪
              </p>
            </div>

            <div style="text-align: center; margin-top: 25px;">
              <a href="https://rebuild-brighten-sparkle.lovable.app/dashboard/applicants?lead=${applicationId}" style="display: inline-block; background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600; font-size: 16px; margin-bottom: 15px;">
                📋 View Closed Lead →
              </a>
              <p style="color: #6b7280; font-size: 14px; margin-top: 15px;">
                Closed on ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
              </p>
            </div>
          </div>
        </div>
      `,
    });

    console.log("Lead closed notification sent:", emailResponse);

    return new Response(
      JSON.stringify({ success: true, emailId: (emailResponse as any).id || "sent" }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );

  } catch (error: any) {
    console.error("Error in notify-lead-closed:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);
