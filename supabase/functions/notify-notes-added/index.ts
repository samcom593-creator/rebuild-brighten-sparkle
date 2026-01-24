import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";
import { Resend } from "npm:resend@2.0.0";

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
    const { agentId, note } = await req.json();

    if (!agentId || !note) {
      throw new Error("Agent ID and note are required");
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    // Get agent info
    const { data: agent, error: agentError } = await supabase
      .from("agents")
      .select("id, user_id, invited_by_manager_id")
      .eq("id", agentId)
      .single();

    if (agentError || !agent) {
      throw new Error("Agent not found");
    }

    // Get agent's profile
    const { data: agentProfile } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("user_id", agent.user_id)
      .single();

    // Get manager's profile
    if (!agent.invited_by_manager_id) {
      console.log("No manager assigned, skipping notification");
      return new Response(
        JSON.stringify({ success: true, skipped: true }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const { data: managerAgent } = await supabase
      .from("agents")
      .select("user_id")
      .eq("id", agent.invited_by_manager_id)
      .single();

    if (!managerAgent) {
      throw new Error("Manager not found");
    }

    const { data: managerProfile } = await supabase
      .from("profiles")
      .select("full_name, email")
      .eq("user_id", managerAgent.user_id)
      .single();

    if (!managerProfile?.email) {
      throw new Error("Manager email not found");
    }

    const agentName = agentProfile?.full_name || "Agent";

    // Send email to manager
    await resend.emails.send({
      from: "King of Sales <notifications@kingofsales.net>",
      to: [managerProfile.email],
      subject: `New Note Added: ${agentName}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #3b82f6;">New Agent Note</h2>
          <p>Hi ${managerProfile.full_name || "Manager"},</p>
          <p>A new note has been added for your agent <strong>${agentName}</strong>:</p>
          <div style="background: #f3f4f6; padding: 16px; border-radius: 8px; margin: 16px 0;">
            <p style="margin: 0; color: #374151;">"${note}"</p>
          </div>
          <p>Log in to the CRM to view full details and history.</p>
          <br/>
          <p>Best regards,<br/>King of Sales System</p>
        </div>
      `,
    });

    console.log(`Note notification sent for agent ${agentId}`);

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: any) {
    console.error("Error in notify-notes-added:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);
