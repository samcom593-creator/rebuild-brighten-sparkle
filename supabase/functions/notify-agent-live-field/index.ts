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

const releaseVideoUrl = "https://youtu.be/fZSm3T1jBJ8";
const portalLink = "https://apex-financial.org/agent-portal";
const discordLink = "https://discord.gg/JpUWA73UZX";

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const { agentId } = await req.json();

    if (!agentId) {
      throw new Error("Missing agentId");
    }

    console.log(`Processing live field notification for agent: ${agentId}`);

    // Get agent profile
    const { data: agent } = await supabase
      .from("agents")
      .select("profile_id, invited_by_manager_id")
      .eq("id", agentId)
      .single();

    if (!agent?.profile_id) {
      throw new Error("Agent profile not found");
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name, email")
      .eq("id", agent.profile_id)
      .single();

    if (!profile?.email) {
      throw new Error("Agent email not found");
    }

    const agentName = profile.full_name || "Agent";
    const agentEmail = profile.email;
    const adminEmail = "sam@apex-financial.org";

    // Get manager info for notification
    let managerEmail: string | null = null;
    if (agent.invited_by_manager_id) {
      const { data: manager } = await supabase
        .from("agents")
        .select("profile_id")
        .eq("id", agent.invited_by_manager_id)
        .single();

      if (manager?.profile_id) {
        const { data: managerProfile } = await supabase
          .from("profiles")
          .select("email")
          .eq("id", manager.profile_id)
          .single();
        managerEmail = managerProfile?.email || null;
      }
    }

    // Email to the agent
    const agentEmailHtml = `
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
        <span style="font-size:64px;">🚀</span>
      </div>
      
      <h2 style="font-size:28px;margin:0 0 16px 0;color:#14b8a6;text-align:center;">You're Officially LIVE!</h2>
      
      <p style="font-size:16px;line-height:1.6;color:#d1d5db;margin:0 0 24px 0;text-align:center;">
        Congratulations <strong style="color:#ffffff;">${agentName}</strong>!<br>
        You've completed field training and are now a live agent.
      </p>
      
      <!-- Release Video -->
      <div style="background:linear-gradient(135deg,rgba(239,68,68,0.2),rgba(249,115,22,0.2));border-radius:8px;padding:20px;margin:24px 0;border:1px solid rgba(239,68,68,0.3);">
        <h3 style="font-size:16px;color:#f87171;margin:0 0 12px 0;">🎬 IMPORTANT: Watch This Video</h3>
        <p style="font-size:14px;color:#d1d5db;margin:0 0 12px 0;">
          Before you get started, watch this essential release video:
        </p>
        <a href="${releaseVideoUrl}" style="display:inline-block;background:#ef4444;color:#ffffff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;">Watch Release Video →</a>
      </div>
      
      <!-- Daily Numbers -->
      <div style="background:rgba(20,184,166,0.1);border-radius:8px;padding:20px;margin:24px 0;">
        <h3 style="font-size:16px;color:#14b8a6;margin:0 0 12px 0;">📊 Log Your Numbers Daily</h3>
        <p style="font-size:14px;color:#d1d5db;margin:0 0 12px 0;">
          Remember to log your production numbers <strong style="color:#ffffff;">every day by 8 PM CST</strong>!
        </p>
        <a href="${portalLink}" style="display:inline-block;background:#14b8a6;color:#ffffff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;">Open Agent Portal →</a>
      </div>
      
      <!-- Discord -->
      <div style="background:rgba(20,184,166,0.1);border-radius:8px;padding:20px;margin:24px 0;">
        <h3 style="font-size:16px;color:#14b8a6;margin:0 0 12px 0;">💬 Stay Connected</h3>
        <p style="font-size:14px;color:#d1d5db;margin:0 0 12px 0;">
          Daily meetings at <strong style="color:#ffffff;">9:30 AM CST</strong> on Discord. Camera on!
        </p>
        <a href="${discordLink}" style="display:inline-block;background:#5865F2;color:#ffffff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;">Join Discord →</a>
      </div>
      
      <!-- The Standard -->
      <div style="background:linear-gradient(135deg,rgba(20,184,166,0.2),rgba(14,165,233,0.2));border-radius:8px;padding:20px;margin:24px 0;border:1px solid rgba(20,184,166,0.3);">
        <h3 style="font-size:16px;color:#14b8a6;margin:0 0 12px 0;">🏆 Time to Perform</h3>
        <p style="font-size:14px;color:#d1d5db;margin:0;">
          The standard is <strong style="color:#ffffff;font-size:18px;">$20,000/month</strong>.<br><br>
          You've proven you're ready. Now it's time to execute.
        </p>
      </div>
      
      <p style="font-size:14px;color:#9ca3af;margin:24px 0 0 0;text-align:center;">
        Let's go make it happen!<br>
        <strong style="color:#ffffff;">— The Apex Team</strong>
      </p>
    </div>
    
    <p style="font-size:12px;color:#6b7280;text-align:center;margin-top:32px;">
      Powered by Apex Financial
    </p>
  </div>
</body>
</html>
    `;

    // Build CC list for agent email
    const agentCcList: string[] = [adminEmail];
    if (managerEmail && managerEmail !== adminEmail) {
      agentCcList.push(managerEmail);
    }

    // Send email to agent
    const { error: emailError } = await resend.emails.send({
      from: "APEX Financial <notifications@apex-financial.org>",
      to: [agentEmail],
      cc: agentCcList,
      subject: `🚀 You're Officially LIVE, ${agentName}!`,
      html: agentEmailHtml,
    });

    if (emailError) {
      console.error("Error sending live field email:", emailError);
      throw new Error(`Failed to send email: ${emailError.message}`);
    }

    const notifyRecipients = [adminEmail];
    if (managerEmail && managerEmail !== adminEmail) {
      notifyRecipients.push(managerEmail);
    }

    await resend.emails.send({
      from: "APEX Financial <notifications@apex-financial.org>",
      to: notifyRecipients,
      subject: `🚀 ${agentName} is Now LIVE in the Field!`,
      html: `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background-color:#0a0a0a;color:#ffffff;">
  <div style="max-width:600px;margin:0 auto;padding:40px 20px;">
    <div style="text-align:center;margin-bottom:32px;">
      <h1 style="font-size:28px;font-weight:bold;margin:0;background:linear-gradient(135deg,#14b8a6,#0ea5e9);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">APEX FINANCIAL</h1>
    </div>
    
    <div style="background:linear-gradient(145deg,#1a1a2e,#16213e);border-radius:16px;padding:32px;border:1px solid rgba(20,184,166,0.2);">
      <div style="text-align:center;">
        <span style="font-size:64px;">🚀</span>
        <h2 style="font-size:24px;margin:16px 0;color:#14b8a6;">${agentName} is LIVE!</h2>
        <p style="font-size:16px;color:#d1d5db;">
          Field training complete. They've been sent the release video and are ready to produce.
        </p>
      </div>
    </div>
    
    <p style="font-size:12px;color:#6b7280;text-align:center;margin-top:32px;">
      Powered by Apex Financial
    </p>
  </div>
</body>
</html>
      `,
    });

    console.log(`Live field notification sent for ${agentName}`);

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: any) {
    console.error("Error in notify-agent-live-field:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);
