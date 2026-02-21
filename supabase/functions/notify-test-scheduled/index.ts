import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { applicationId, testDate } = await req.json();
    if (!applicationId || !testDate) {
      return new Response(JSON.stringify({ error: "applicationId and testDate required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Fetch application details
    const { data: app, error: appError } = await supabase
      .from("applications")
      .select("id, first_name, last_name, email, assigned_agent_id")
      .eq("id", applicationId)
      .single();

    if (appError || !app) {
      console.error("Application not found:", appError);
      return new Response(JSON.stringify({ error: "Application not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const applicantName = `${app.first_name} ${app.last_name}`.trim();
    const formattedDate = new Date(testDate + "T12:00:00").toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });

    // Collect all CC emails
    const adminEmail = "info@apex-financial.org";
    const ccList: string[] = [adminEmail];

    // Get direct manager email
    if (app.assigned_agent_id) {
      const { data: agent } = await supabase
        .from("agents")
        .select("invited_by_manager_id")
        .eq("id", app.assigned_agent_id)
        .single();

      if (agent?.invited_by_manager_id) {
        const { data: mgrAgent } = await supabase
          .from("agents")
          .select("user_id")
          .eq("id", agent.invited_by_manager_id)
          .single();

        if (mgrAgent?.user_id) {
          const { data: mgrProfile } = await supabase
            .from("profiles")
            .select("email")
            .eq("user_id", mgrAgent.user_id)
            .single();
          if (mgrProfile?.email) ccList.push(mgrProfile.email);
        }
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
          if (mp.email) ccList.push(mp.email);
        }
      }
    }

    // Deduplicate
    const uniqueCcList = [...new Set(ccList)];

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) {
      return new Response(JSON.stringify({ error: "RESEND_API_KEY not set" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Send to applicant with CC
    const emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #111; color: #fff; border-radius: 12px; overflow: hidden;">
        <div style="background: linear-gradient(135deg, #6366f1, #8b5cf6); padding: 24px; text-align: center;">
          <h1 style="margin: 0; font-size: 22px; color: #fff;">📅 Licensing Exam Scheduled</h1>
        </div>
        <div style="padding: 24px;">
          <p style="font-size: 16px; margin-bottom: 16px;">Hi ${app.first_name},</p>
          <p style="font-size: 14px; line-height: 1.6; margin-bottom: 16px;">
            Your licensing exam has been scheduled for:
          </p>
          <div style="background: #1a1a2e; border: 1px solid #6366f1; border-radius: 8px; padding: 16px; text-align: center; margin-bottom: 16px;">
            <p style="font-size: 20px; font-weight: bold; color: #8b5cf6; margin: 0;">${formattedDate}</p>
          </div>
          <p style="font-size: 14px; line-height: 1.6; margin-bottom: 8px;"><strong>Prep Tips:</strong></p>
          <ul style="font-size: 14px; line-height: 1.8; padding-left: 20px; margin-bottom: 16px;">
            <li>Review all course materials one more time</li>
            <li>Get plenty of rest the night before</li>
            <li>Bring valid photo ID to the testing center</li>
            <li>Arrive 15-30 minutes early</li>
          </ul>
          <p style="font-size: 14px; line-height: 1.6;">
            You've got this! Reach out if you have any questions before your exam.
          </p>
        </div>
        <div style="padding: 16px; text-align: center; border-top: 1px solid #222; font-size: 11px; color: #666;">
          Powered by Apex Financial
        </div>
      </div>
    `;

    if (app.email) {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "APEX Financial <noreply@apex-financial.org>",
          to: [app.email],
          cc: uniqueCcList,
          subject: `📅 Licensing Exam Scheduled – ${formattedDate}`,
          html: emailHtml,
        }),
      });

      const result = await res.json();
      console.log("Test scheduled email sent:", result);
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Error in notify-test-scheduled:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
