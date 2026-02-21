import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ADMIN_EMAIL = "info@apex-financial.org";
const FROM_EMAIL = "APEX Financial <noreply@apex-financial.org>";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    const {
      applicationId,
      interviewDate,
      interviewType,
      meetingLink,
      notes,
    } = await req.json();

    if (!applicationId || !interviewDate) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get application details + assigned agent
    const { data: app, error: appError } = await supabase
      .from("applications")
      .select("*, agents!applications_assigned_agent_id_fkey(id, user_id, invited_by_manager_id)")
      .eq("id", applicationId)
      .single();

    if (appError || !app) {
      return new Response(JSON.stringify({ error: "Application not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const interviewDateObj = new Date(interviewDate);
    const dateStr = interviewDateObj.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    const timeStr = interviewDateObj.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    });

    const typeLabels: Record<string, string> = {
      video: "Video Call",
      phone: "Phone Call",
      in_person: "In-Person Meeting",
    };
    const typeLabel = typeLabels[interviewType] || interviewType;

    // Collect CC emails: admin + assigned agent + direct manager + ALL managers
    const ccEmails: string[] = [ADMIN_EMAIL];

    if (app.agents?.user_id) {
      const { data: agentProfile } = await supabase
        .from("profiles")
        .select("email")
        .eq("user_id", app.agents.user_id)
        .single();
      if (agentProfile?.email) ccEmails.push(agentProfile.email);
    }

    if (app.agents?.invited_by_manager_id) {
      const { data: managerAgent } = await supabase
        .from("agents")
        .select("user_id")
        .eq("id", app.agents.invited_by_manager_id)
        .single();
      if (managerAgent?.user_id) {
        const { data: managerProfile } = await supabase
          .from("profiles")
          .select("email")
          .eq("user_id", managerAgent.user_id)
          .single();
        if (managerProfile?.email) ccEmails.push(managerProfile.email);
      }
    }

    // Get ALL manager emails
    const { data: managerRoles } = await supabase
      .from("user_roles")
      .select("user_id")
      .eq("role", "manager");

    if (managerRoles && managerRoles.length > 0) {
      const managerUserIds = managerRoles.map((r: any) => r.user_id);
      const { data: managerProfiles } = await supabase
        .from("profiles")
        .select("email")
        .in("user_id", managerUserIds);

      if (managerProfiles) {
        for (const mp of managerProfiles) {
          if (mp.email) ccEmails.push(mp.email);
        }
      }
    }

    const uniqueCcEmails = [...new Set(ccEmails)];

    // Build email body
    const emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #0f1117; color: #e2e8f0; border-radius: 12px; overflow: hidden;">
        <div style="background: linear-gradient(135deg, #1a1f2e, #0f1117); padding: 32px; text-align: center; border-bottom: 1px solid #2d3748;">
          <h1 style="margin: 0; font-size: 24px; font-weight: 700; color: #ffffff;">Interview Scheduled</h1>
          <p style="margin: 8px 0 0; color: #94a3b8; font-size: 14px;">APEX Financial</p>
        </div>
        <div style="padding: 32px;">
          <p style="font-size: 16px; margin: 0 0 24px;">Hi ${app.first_name},</p>
          <p style="color: #cbd5e1; margin: 0 0 24px;">Your interview has been scheduled! Here are the details:</p>

          <div style="background: #1e2330; border-radius: 8px; padding: 20px; margin-bottom: 24px; border: 1px solid #2d3748;">
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="color: #64748b; padding: 6px 0; font-size: 13px;">📅 Date</td>
                <td style="color: #e2e8f0; padding: 6px 0; font-size: 13px; font-weight: 600;">${dateStr}</td>
              </tr>
              <tr>
                <td style="color: #64748b; padding: 6px 0; font-size: 13px;">⏰ Time</td>
                <td style="color: #e2e8f0; padding: 6px 0; font-size: 13px; font-weight: 600;">${timeStr}</td>
              </tr>
              <tr>
                <td style="color: #64748b; padding: 6px 0; font-size: 13px;">📋 Type</td>
                <td style="color: #e2e8f0; padding: 6px 0; font-size: 13px; font-weight: 600;">${typeLabel}</td>
              </tr>
              ${meetingLink ? `
              <tr>
                <td style="color: #64748b; padding: 6px 0; font-size: 13px;">🔗 Link</td>
                <td style="padding: 6px 0;">
                  <a href="${meetingLink}" style="color: #6366f1; font-size: 13px;">${meetingLink}</a>
                </td>
              </tr>
              ` : ""}
              ${notes ? `
              <tr>
                <td style="color: #64748b; padding: 6px 0; font-size: 13px;">📝 Notes</td>
                <td style="color: #e2e8f0; padding: 6px 0; font-size: 13px;">${notes}</td>
              </tr>
              ` : ""}
            </table>
          </div>

          <p style="color: #94a3b8; font-size: 13px; margin: 0;">
            We look forward to speaking with you! If you need to reschedule, please reply to this email.
          </p>
        </div>
        <div style="padding: 20px 32px; border-top: 1px solid #2d3748; text-align: center;">
          <p style="font-size: 11px; color: #475569; margin: 0;">Powered by <strong style="color: #6366f1;">APEX Financial</strong></p>
        </div>
      </div>
    `;

    // Send email via Resend
    const emailPayload: any = {
      from: FROM_EMAIL,
      to: [app.email],
      cc: uniqueCcEmails,
      subject: `Interview Scheduled: ${dateStr} at ${timeStr}`,
      html: emailHtml,
    };

    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(emailPayload),
    });

    if (!emailRes.ok) {
      const emailErr = await emailRes.text();
      console.error("Email send failed:", emailErr);
    }

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("schedule-interview error:", err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
