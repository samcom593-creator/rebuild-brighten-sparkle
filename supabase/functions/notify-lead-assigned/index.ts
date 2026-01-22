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

interface NotifyLeadAssignedRequest {
  applicationId: string;
  newAgentId: string;
  previousAgentId?: string | null;
}

// Get agent info by agent ID
async function getAgentInfo(agentId: string): Promise<{ email: string; name: string } | null> {
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
    
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("email, full_name")
      .eq("user_id", agent.user_id)
      .single();
    
    if (profileError || !profile?.email) {
      console.log("Could not find profile:", profileError);
      return null;
    }
    
    return {
      email: profile.email,
      name: profile.full_name || profile.email.split("@")[0],
    };
  } catch (err) {
    console.error("Error getting agent info:", err);
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
  console.log("notify-lead-assigned: Received request");
  
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { applicationId, newAgentId, previousAgentId }: NotifyLeadAssignedRequest = await req.json();
    
    if (!applicationId || !newAgentId) {
      return new Response(
        JSON.stringify({ error: "Missing applicationId or newAgentId" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    console.log(`Processing lead assignment notification for app ${applicationId}, agent ${newAgentId}`);

    // Get application details
    const { data: app, error: appError } = await supabaseAdmin
      .from("applications")
      .select("first_name, last_name, email, phone, city, state, license_status, instagram_handle, contacted_at, qualified_at")
      .eq("id", applicationId)
      .single();

    if (appError || !app) {
      console.error("Could not find application:", appError);
      return new Response(
        JSON.stringify({ error: "Application not found" }),
        { status: 404, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Get new agent info
    const newAgentInfo = await getAgentInfo(newAgentId);
    
    if (!newAgentInfo) {
      console.log("No new agent info found, skipping notification");
      return new Response(
        JSON.stringify({ success: true, skipped: true, reason: "No agent email found" }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Get previous agent info (if any) for context
    let previousAgentName: string | null = null;
    if (previousAgentId) {
      const previousAgentInfo = await getAgentInfo(previousAgentId);
      previousAgentName = previousAgentInfo?.name || null;
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
      phone: sanitizeHtml(app.phone || "Not provided"),
      city: sanitizeHtml(app.city || "Unknown"),
      state: sanitizeHtml(app.state || ""),
      instagramHandle: app.instagram_handle ? sanitizeHtml(app.instagram_handle) : null,
    };

    const licenseStatusMap: Record<string, string> = {
      licensed: "Licensed",
      unlicensed: "Not Yet Licensed",
      pending: "License Pending",
    };
    const licenseStatusDisplay = licenseStatusMap[app.license_status] || app.license_status;

    // Determine lead status
    let leadStatus = "New";
    let statusColor = "#3b82f6"; // blue
    if (app.qualified_at) {
      leadStatus = "Qualified";
      statusColor = "#8b5cf6"; // purple
    } else if (app.contacted_at) {
      leadStatus = "Contacted";
      statusColor = "#f59e0b"; // amber
    }

    const isReassignment = !!previousAgentId;
    const subject = isReassignment 
      ? `🔄 Lead Reassigned: ${sanitized.firstName} ${sanitized.lastName}`
      : `📥 New Lead Assigned: ${sanitized.firstName} ${sanitized.lastName}`;

    // Send notification email to new agent
    const emailResponse = await resend.emails.send({
      from: "APEX Notifications <noreply@apex-financial.org>",
      to: [newAgentInfo.email],
      subject,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #3b82f6, #2563eb); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 28px;">${isReassignment ? '🔄 Lead Reassigned' : '📥 New Lead!'}</h1>
            <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0; font-size: 16px;">You have a new lead to work on</p>
          </div>
          
          <div style="background: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px;">
            <h2 style="color: #111827; margin-top: 0;">Hi ${newAgentInfo.name},</h2>
            
            <p style="color: #4b5563; line-height: 1.6;">
              ${isReassignment 
                ? `A lead has been reassigned to you${previousAgentName ? ` from ${previousAgentName}` : ''}. Here are the details:`
                : 'A new lead has been assigned to you! Here are the details:'}
            </p>

            <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border: 1px solid #e5e7eb;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                <h3 style="margin: 0; color: #111827;">Lead Information</h3>
                <span style="background: ${statusColor}22; color: ${statusColor}; padding: 4px 12px; border-radius: 20px; font-size: 14px; font-weight: 500;">
                  ${leadStatus}
                </span>
              </div>
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; color: #6b7280; width: 40%;">Name:</td>
                  <td style="padding: 8px 0; font-weight: bold;">${sanitized.firstName} ${sanitized.lastName}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #6b7280;">Email:</td>
                  <td style="padding: 8px 0;"><a href="mailto:${app.email}" style="color: #2563eb;">${sanitized.email}</a></td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #6b7280;">Phone:</td>
                  <td style="padding: 8px 0;"><a href="tel:${app.phone}" style="color: #2563eb;">${sanitized.phone}</a></td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #6b7280;">Location:</td>
                  <td style="padding: 8px 0;">${sanitized.city}, ${sanitized.state}</td>
                </tr>
                ${sanitized.instagramHandle ? `
                <tr>
                  <td style="padding: 8px 0; color: #6b7280;">Instagram:</td>
                  <td style="padding: 8px 0;"><a href="https://instagram.com/${sanitized.instagramHandle.replace('@', '')}" style="color: #2563eb;">${sanitized.instagramHandle}</a></td>
                </tr>
                ` : ''}
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

            <div style="background: #dbeafe; border-left: 4px solid #2563eb; padding: 15px 20px; margin: 20px 0; border-radius: 0 8px 8px 0;">
              <p style="margin: 0; color: #1d4ed8; font-weight: 500;">
                💡 Tip: Reach out within 24 hours for the best results!
              </p>
            </div>

            <div style="text-align: center; margin-top: 25px;">
              <p style="color: #6b7280; font-size: 14px;">
                Assigned on ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
              </p>
            </div>
          </div>
        </div>
      `,
    });

    console.log("Lead assignment notification sent:", emailResponse);

    return new Response(
      JSON.stringify({ success: true, emailId: (emailResponse as any).id || "sent" }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );

  } catch (error: any) {
    console.error("Error in notify-lead-assigned:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);
