import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";
import { Resend } from "https://esm.sh/resend@2.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const ADMIN_EMAIL = "sam@apex-financial.org";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { agentId, date, attendanceType } = await req.json();

    if (!agentId) {
      throw new Error("Agent ID is required");
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const { data: agent, error: agentError } = await supabase
      .from("agents")
      .select("id, user_id, invited_by_manager_id")
      .eq("id", agentId)
      .single();

    if (agentError || !agent) {
      throw new Error("Agent not found");
    }

    const { data: agentProfile } = await supabase
      .from("profiles")
      .select("full_name, email")
      .eq("user_id", agent.user_id)
      .single();

    let managerEmail: string | null = null;
    let managerName: string | null = null;

    if (agent.invited_by_manager_id) {
      const { data: managerAgent } = await supabase
        .from("agents")
        .select("user_id")
        .eq("id", agent.invited_by_manager_id)
        .single();

      if (managerAgent) {
        const { data: managerProfile } = await supabase
          .from("profiles")
          .select("full_name, email")
          .eq("user_id", managerAgent.user_id)
          .single();

        if (managerProfile) {
          managerEmail = managerProfile.email;
          managerName = managerProfile.full_name;
        }
      }
    }

    const agentName = agentProfile?.full_name || "Agent";
    const agentEmail = agentProfile?.email;
    const attendanceLabel = attendanceType === "training" ? "daily training" : "team meeting";
    const dateStr = date || new Date().toLocaleDateString("en-US", { 
      weekday: "long", 
      month: "long", 
      day: "numeric" 
    });

    // Send email to agent with admin CC
    if (agentEmail) {
      await resend.emails.send({
        from: "Apex Financial <notifications@apex-financial.org>",
        to: [agentEmail],
        cc: [ADMIN_EMAIL],
        subject: `Missed ${attendanceLabel.charAt(0).toUpperCase() + attendanceLabel.slice(1)} - ${dateStr}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #ef4444;">Attendance Alert</h2>
            <p>Hi ${agentName},</p>
            <p>You were marked as <strong>not present</strong> for ${attendanceLabel} on ${dateStr}.</p>
            <p>If this was an error or you have a valid reason for your absence, please reach out to your manager immediately.</p>
            <p>Consistent attendance is crucial for your success in the program.</p>
            <br/>
            <p>Best regards,<br/>Apex Financial Team</p>
          </div>
        `,
      });
    }

    // Send email to manager with admin CC
    if (managerEmail) {
      await resend.emails.send({
        from: "Apex Financial <notifications@apex-financial.org>",
        to: [managerEmail],
        cc: [ADMIN_EMAIL],
        subject: `Agent Absent: ${agentName} - ${dateStr}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #f59e0b;">Attendance Notification</h2>
            <p>Hi ${managerName || "Manager"},</p>
            <p>Your agent <strong>${agentName}</strong> was marked as absent for ${attendanceLabel} on ${dateStr}.</p>
            <p>Please follow up with them to understand the reason for their absence.</p>
            <br/>
            <p>Best regards,<br/>Apex Financial</p>
          </div>
        `,
      });
    }

    console.log(`Attendance notifications sent for agent ${agentId}, CC: ${ADMIN_EMAIL}`);

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: any) {
    console.error("Error in notify-attendance-missing:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);
