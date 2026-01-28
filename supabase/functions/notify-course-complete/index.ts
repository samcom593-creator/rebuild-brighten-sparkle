import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";
import { Resend } from "https://esm.sh/resend@2.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const { agentId, agentName, agentEmail } = await req.json();

    if (!agentId) {
      throw new Error("Missing agentId");
    }

    // Get agent's manager
    const { data: agent } = await supabase
      .from("agents")
      .select("invited_by_manager_id, profile_id")
      .eq("id", agentId)
      .single();

    // Get agent profile
    let finalAgentName = agentName || "Agent";
    let finalAgentEmail = agentEmail;
    if (agent?.profile_id) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name, email")
        .eq("id", agent.profile_id)
        .single();
      if (profile) {
        finalAgentName = agentName || profile.full_name || "Agent";
        finalAgentEmail = agentEmail || profile.email;
      }
    }

    // Get admin email
    const adminEmail = "info@kingofsales.net";

    // Get manager's email if exists
    let managerEmail: string | null = null;
    let managerName = "Apex Team";
    if (agent?.invited_by_manager_id) {
      const { data: manager } = await supabase
        .from("agents")
        .select("profile_id")
        .eq("id", agent.invited_by_manager_id)
        .single();

      if (manager?.profile_id) {
        const { data: managerProfile } = await supabase
          .from("profiles")
          .select("full_name, email")
          .eq("id", manager.profile_id)
          .single();
        if (managerProfile?.email) {
          managerEmail = managerProfile.email;
          managerName = managerProfile.full_name || "Manager";
        }
      }
    }

    // Build recipient list (only admin + assigned manager)
    const recipients: string[] = [adminEmail];
    if (managerEmail && managerEmail !== adminEmail) {
      recipients.push(managerEmail);
    }

    // Send notification email
    const { error: emailError } = await resend.emails.send({
      from: "Apex Financial <team@updates.apexlifeadvisors.com>",
      to: recipients,
      subject: `🎓 ${finalAgentName} Completed Onboarding Course!`,
      html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background-color:#0a0a0a;color:#ffffff;">
  <div style="max-width:600px;margin:0 auto;padding:40px 20px;">
    <div style="text-align:center;margin-bottom:32px;">
      <h1 style="font-size:28px;font-weight:bold;margin:0;background:linear-gradient(135deg,#14b8a6,#0ea5e9);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">APEX FINANCIAL</h1>
    </div>
    
    <div style="background:linear-gradient(145deg,#1a1a2e,#16213e);border-radius:16px;padding:32px;border:1px solid rgba(20,184,166,0.2);">
      <div style="text-align:center;margin-bottom:24px;">
        <span style="font-size:64px;">🎓</span>
      </div>
      
      <h2 style="font-size:24px;margin:0 0 16px 0;color:#14b8a6;text-align:center;">Course Completed!</h2>
      
      <p style="font-size:16px;line-height:1.6;color:#d1d5db;margin:0 0 16px 0;text-align:center;">
        <strong style="color:#ffffff;font-size:20px;">${finalAgentName}</strong><br/>
        has completed all onboarding coursework!
      </p>
      
      <div style="background:rgba(20,184,166,0.1);border-radius:8px;padding:20px;margin:24px 0;text-align:center;">
        <p style="font-size:14px;color:#14b8a6;margin:0 0 8px 0;font-weight:bold;">NEXT STEP:</p>
        <p style="font-size:16px;color:#ffffff;margin:0;">Ready for Field Training</p>
      </div>
      
      <div style="border-left:3px solid #14b8a6;padding-left:16px;margin:24px 0;">
        <p style="font-size:14px;color:#9ca3af;margin:0;">
          <strong style="color:#ffffff;">Recommended Actions:</strong><br>
          • Schedule first field training session<br>
          • Verify CRM access is set up<br>
          • Confirm Discord channel access<br>
          • Review initial lead assignments
        </p>
      </div>
      
      ${finalAgentEmail ? `
      <p style="font-size:14px;color:#9ca3af;margin:24px 0 0 0;text-align:center;">
        Contact: <a href="mailto:${finalAgentEmail}" style="color:#14b8a6;">${finalAgentEmail}</a>
      </p>
      ` : ''}
    </div>
    
    <p style="font-size:12px;color:#6b7280;text-align:center;margin-top:32px;">
      Powered by Apex Financial
    </p>
  </div>
</body>
</html>
      `,
    });

    if (emailError) {
      console.error("Error sending course complete email:", emailError);
      throw new Error(`Failed to send email: ${emailError.message}`);
    }

    // Update agent's onboarding stage to in_field_training
    await supabase
      .from("agents")
      .update({ onboarding_stage: "in_field_training" })
      .eq("id", agentId);

    // Log the progression event
    await supabase.from("agent_onboarding").insert({
      agent_id: agentId,
      stage: "in_field_training",
      notes: "Completed online coursework, ready for field training",
    });

    console.log(`Course completion notification sent for ${finalAgentName}`);

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: any) {
    console.error("Error in notify-course-complete:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);
