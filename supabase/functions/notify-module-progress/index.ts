import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.2";
import { Resend } from "npm:resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

interface NotifyModuleProgressRequest {
  agentId: string;
  moduleId: string;
  moduleTitle: string;
  moduleIndex: number;
  totalModules: number;
  score: number;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: NotifyModuleProgressRequest = await req.json();
    const { agentId, moduleId, moduleTitle, moduleIndex, totalModules, score } = body;

    if (!agentId || !moduleId) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    console.log(`Notifying manager for agent ${agentId} completing module ${moduleIndex + 1}`);

    // Get agent info
    const { data: agent } = await supabaseAdmin
      .from("agents")
      .select("user_id, invited_by_manager_id")
      .eq("id", agentId)
      .single();

    if (!agent) {
      console.log("Agent not found");
      return new Response(
        JSON.stringify({ error: "Agent not found" }),
        { status: 404, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Get agent's profile
    const { data: agentProfile } = await supabaseAdmin
      .from("profiles")
      .select("full_name")
      .eq("user_id", agent.user_id)
      .single();

    const agentName = agentProfile?.full_name || "An agent";

    // Get manager info
    if (!agent.invited_by_manager_id) {
      console.log("No manager assigned");
      return new Response(
        JSON.stringify({ message: "No manager to notify" }),
        { headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const { data: manager } = await supabaseAdmin
      .from("agents")
      .select("user_id")
      .eq("id", agent.invited_by_manager_id)
      .single();

    if (!manager) {
      console.log("Manager not found");
      return new Response(
        JSON.stringify({ error: "Manager not found" }),
        { status: 404, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const { data: managerProfile } = await supabaseAdmin
      .from("profiles")
      .select("email, full_name")
      .eq("user_id", manager.user_id)
      .single();

    if (!managerProfile?.email) {
      console.log("Manager email not found");
      return new Response(
        JSON.stringify({ error: "Manager email not found" }),
        { status: 404, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const progressPercent = Math.round(((moduleIndex + 1) / totalModules) * 100);
    const isComplete = moduleIndex + 1 === totalModules;

    const emailHtml = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px;">
        <div style="text-align: center; margin-bottom: 24px;">
          ${isComplete 
            ? '<div style="font-size: 48px;">🎉</div>' 
            : '<div style="font-size: 48px;">📚</div>'
          }
        </div>
        
        <h1 style="color: #1a1a1a; text-align: center; margin-bottom: 16px;">
          ${isComplete ? 'Course Complete!' : 'Module Completed'}
        </h1>
        
        <div style="background: #f5f5f5; border-radius: 12px; padding: 20px; text-align: center;">
          <p style="margin: 0 0 8px 0; color: #666;">
            <strong>${agentName}</strong> ${isComplete ? 'completed the entire course!' : 'passed a module'}
          </p>
          
          <div style="background: white; border-radius: 8px; padding: 16px; margin: 16px 0;">
            <p style="margin: 0 0 4px 0; font-size: 14px; color: #666;">Module ${moduleIndex + 1} of ${totalModules}</p>
            <p style="margin: 0; font-size: 18px; font-weight: bold;">${moduleTitle}</p>
            <p style="margin: 8px 0 0 0; font-size: 14px; color: #22c55e;">Score: ${score}%</p>
          </div>
          
          <div style="margin-top: 16px;">
            <div style="background: #e5e7eb; border-radius: 9999px; height: 8px; overflow: hidden;">
              <div style="background: ${isComplete ? '#22c55e' : '#3b82f6'}; height: 100%; width: ${progressPercent}%;"></div>
            </div>
            <p style="margin: 8px 0 0 0; font-size: 14px; color: #666;">
              ${progressPercent}% complete
            </p>
          </div>
        </div>

        <p style="color: #999; font-size: 12px; text-align: center; margin-top: 24px;">
          Powered by Apex Financial
        </p>
      </div>
    `;

    const { error: emailError } = await resend.emails.send({
      from: "Apex Financial <team@apex-financial.org>",
      to: [managerProfile.email],
      subject: isComplete 
        ? `🎉 ${agentName} completed the onboarding course!`
        : `📚 ${agentName} passed Module ${moduleIndex + 1}/${totalModules}`,
      html: emailHtml,
    });

    if (emailError) {
      console.error("Email error:", emailError);
      throw emailError;
    }

    console.log(`Notification sent to ${managerProfile.email}`);

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: unknown) {
    console.error("Error in notify-module-progress:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
};

serve(handler);
