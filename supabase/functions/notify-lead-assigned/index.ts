import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const resendApiKey = Deno.env.get("RESEND_API_KEY");

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

const resend = resendApiKey ? new Resend(resendApiKey) : null;

const ADMIN_EMAIL = "sam@apex-financial.org";

interface NotifyLeadAssignedRequest {
  applicationId: string;
  newAgentId: string;
  previousAgentId?: string | null;
}

async function getAgentInfo(agentId: string): Promise<{ email: string; name: string; userId: string | null } | null> {
  try {
    const { data: agent, error: agentError } = await supabaseAdmin
      .from("agents")
      .select("user_id")
      .eq("id", agentId)
      .single();
    
    if (agentError || !agent?.user_id) return null;
    
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.getUserById(agent.user_id);
    
    if (!authError && authData?.user?.email) {
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("full_name")
        .eq("user_id", agent.user_id)
        .maybeSingle();
      
      return {
        email: authData.user.email,
        name: profile?.full_name || authData.user.email.split("@")[0],
        userId: agent.user_id,
      };
    }
    
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("email, full_name")
      .eq("user_id", agent.user_id)
      .single();
    
    if (profileError || !profile?.email) return null;
    
    return {
      email: profile.email,
      name: profile.full_name || profile.email.split("@")[0],
      userId: agent.user_id,
    };
  } catch (err) {
    console.error("Error getting agent info:", err);
    return null;
  }
}

async function getManagerInfo(agentId: string): Promise<{ email: string; userId: string } | null> {
  try {
    const { data: agent } = await supabaseAdmin.from("agents").select("invited_by_manager_id").eq("id", agentId).single();
    if (!agent?.invited_by_manager_id) return null;
    const { data: manager } = await supabaseAdmin.from("agents").select("user_id").eq("id", agent.invited_by_manager_id).single();
    if (!manager?.user_id) return null;
    const { data: authData } = await supabaseAdmin.auth.admin.getUserById(manager.user_id);
    return authData?.user?.email ? { email: authData.user.email, userId: manager.user_id } : null;
  } catch (e) {
    console.error("Error resolving manager info:", e);
    return null;
  }
}

async function sendPush(userIds: string[], title: string, body: string, url: string) {
  try {
    const validIds = userIds.filter(Boolean);
    if (validIds.length === 0) return;
    await fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify({ userIds: validIds, title, body, url }),
    });
    console.log(`Push sent to ${validIds.length} user(s)`);
  } catch (e) {
    console.error("Push failed:", e);
  }
}

function sanitizeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { applicationId, newAgentId, previousAgentId }: NotifyLeadAssignedRequest = await req.json();
    if (!applicationId || !newAgentId) {
      return new Response(JSON.stringify({ error: "Missing applicationId or newAgentId" }), { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } });
    }

    console.log(`Processing lead assignment for app ${applicationId}, agent ${newAgentId}`);

    const { data: app, error: appError } = await supabaseAdmin
      .from("applications")
      .select("first_name, last_name, email, phone, city, state, license_status, instagram_handle, contacted_at, qualified_at")
      .eq("id", applicationId)
      .single();

    if (appError || !app) {
      return new Response(JSON.stringify({ error: "Application not found" }), { status: 404, headers: { "Content-Type": "application/json", ...corsHeaders } });
    }

    const newAgentInfo = await getAgentInfo(newAgentId);
    if (!newAgentInfo) {
      return new Response(JSON.stringify({ success: true, skipped: true, reason: "No agent email found" }), { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } });
    }

    // Send push to assigned agent + manager
    const managerInfo = await getManagerInfo(newAgentId);
    const pushTargets = [newAgentInfo.userId, managerInfo?.userId].filter(Boolean) as string[];
    const isReassignment = !!previousAgentId;
    
    await sendPush(
      pushTargets,
      isReassignment ? "🔄 Lead Reassigned" : "📥 New Lead Assigned!",
      `${app.first_name} ${app.last_name} — ${app.city || ""}, ${app.state || ""}`,
      `/dashboard/applicants?lead=${applicationId}`
    );

    if (!resend) {
      return new Response(JSON.stringify({ success: true, skipped: true, reason: "Email not configured" }), { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } });
    }

    let previousAgentName: string | null = null;
    if (previousAgentId) {
      const prev = await getAgentInfo(previousAgentId);
      previousAgentName = prev?.name || null;
    }

    const ccList = [ADMIN_EMAIL, managerInfo?.email].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i) as string[];

    const sanitized = {
      firstName: sanitizeHtml(app.first_name),
      lastName: sanitizeHtml(app.last_name),
      email: sanitizeHtml(app.email),
      phone: sanitizeHtml(app.phone || "Not provided"),
      city: sanitizeHtml(app.city || "Unknown"),
      state: sanitizeHtml(app.state || ""),
      instagramHandle: app.instagram_handle ? sanitizeHtml(app.instagram_handle) : null,
    };

    const licenseStatusMap: Record<string, string> = { licensed: "Licensed", unlicensed: "Not Yet Licensed", pending: "License Pending" };
    const licenseStatusDisplay = licenseStatusMap[app.license_status] || app.license_status;

    let leadStatus = "New";
    let statusColor = "#3b82f6";
    if (app.qualified_at) { leadStatus = "Qualified"; statusColor = "#8b5cf6"; }
    else if (app.contacted_at) { leadStatus = "Contacted"; statusColor = "#f59e0b"; }

    const subject = isReassignment
      ? `🔄 Lead Reassigned: ${sanitized.firstName} ${sanitized.lastName}`
      : `📥 New Lead Assigned: ${sanitized.firstName} ${sanitized.lastName}`;

    const emailResponse = await resend.emails.send({
      from: "APEX Notifications <notifications@apex-financial.org>",
      to: [newAgentInfo.email],
      cc: ccList.length > 0 ? ccList : undefined,
      subject,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; word-break: break-word;">
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
                <span style="background: ${statusColor}22; color: ${statusColor}; padding: 4px 12px; border-radius: 20px; font-size: 14px; font-weight: 500;">${leadStatus}</span>
              </div>
              <table style="width: 100%; border-collapse: collapse;">
                <tr><td style="padding: 8px 0; color: #6b7280; width: 40%;">Name:</td><td style="padding: 8px 0; font-weight: bold;">${sanitized.firstName} ${sanitized.lastName}</td></tr>
                <tr><td style="padding: 8px 0; color: #6b7280;">Email:</td><td style="padding: 8px 0;"><a href="mailto:${app.email}" style="color: #2563eb;">${sanitized.email}</a></td></tr>
                <tr><td style="padding: 8px 0; color: #6b7280;">Phone:</td><td style="padding: 8px 0;"><a href="tel:${app.phone}" style="color: #2563eb;">${sanitized.phone}</a></td></tr>
                <tr><td style="padding: 8px 0; color: #6b7280;">Location:</td><td style="padding: 8px 0;">${sanitized.city}, ${sanitized.state}</td></tr>
                ${sanitized.instagramHandle ? `<tr><td style="padding: 8px 0; color: #6b7280;">Instagram:</td><td style="padding: 8px 0;"><a href="https://instagram.com/${sanitized.instagramHandle.replace('@', '')}" style="color: #2563eb;">${sanitized.instagramHandle}</a></td></tr>` : ''}
                <tr><td style="padding: 8px 0; color: #6b7280;">License Status:</td><td style="padding: 8px 0;"><span style="background: ${app.license_status === 'licensed' ? '#d1fae5' : app.license_status === 'pending' ? '#fef3c7' : '#fee2e2'}; color: ${app.license_status === 'licensed' ? '#047857' : app.license_status === 'pending' ? '#92400e' : '#991b1b'}; padding: 4px 12px; border-radius: 20px; font-size: 14px; font-weight: 500;">${licenseStatusDisplay}</span></td></tr>
              </table>
            </div>
            <div style="background: #dbeafe; border-left: 4px solid #2563eb; padding: 15px 20px; margin: 20px 0; border-radius: 0 8px 8px 0;">
              <p style="margin: 0; color: #1d4ed8; font-weight: 500;">💡 Tip: Reach out within 24 hours for the best results!</p>
            </div>
            <div style="text-align: center; margin-top: 25px;">
              <a href="https://rebuild-brighten-sparkle.lovable.app/dashboard/applicants?lead=${applicationId}" style="display: inline-block; background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); color: white; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600; font-size: 16px; margin-bottom: 15px; max-width:100%; box-sizing:border-box;">📞 View Lead & Call Now →</a>
              <p style="color: #6b7280; font-size: 14px; margin-top: 15px;">Assigned on ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
            </div>
          </div>
        </div>
      `,
    });

    console.log("Lead assignment notification sent:", emailResponse, "CC:", ccList.join(", "));
    return new Response(JSON.stringify({ success: true, emailId: (emailResponse as any).id || "sent" }), { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } });
  } catch (error: any) {
    console.error("Error in notify-lead-assigned:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } });
  }
};

serve(handler);
