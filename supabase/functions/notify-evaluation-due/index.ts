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

    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Get agents who started field training 7+ days ago and haven't been evaluated
    const { data: dueAgents, error } = await supabase
      .from("agents")
      .select("id, user_id, invited_by_manager_id, field_training_started_at")
      .eq("status", "active")
      .eq("onboarding_stage", "in_field_training")
      .is("evaluation_result", null)
      .lte("field_training_started_at", sevenDaysAgo.toISOString());

    if (error) throw error;

    if (!dueAgents?.length) {
      console.log("No agents due for evaluation");
      return new Response(
        JSON.stringify({ success: true, notified: 0 }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    let notifiedCount = 0;

    for (const agent of dueAgents) {
      // Get agent profile
      const { data: agentProfile } = await supabase
        .from("profiles")
        .select("full_name, email")
        .eq("user_id", agent.user_id)
        .single();

      // Get manager info
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
      const startDate = new Date(agent.field_training_started_at!);
      const daysInTraining = Math.floor((now.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000));

      // Send to agent
      if (agentEmail) {
        try {
          await resend.emails.send({
            from: "Apex Financial <notifications@apex-financial.org>",
            to: [agentEmail],
            subject: "⏰ Your Field Training Evaluation is Due!",
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #f59e0b;">Evaluation Time!</h2>
                <p>Hi ${agentName},</p>
                <p>You have completed <strong>${daysInTraining} days</strong> of field training, and your evaluation is now due.</p>
                <div style="background: #fef3c7; border-left: 4px solid #f59e0b; padding: 16px; margin: 16px 0;">
                  <p style="margin: 0;"><strong>What happens next?</strong></p>
                  <p style="margin: 8px 0 0 0;">Your manager or trainer will evaluate your performance and mark you as Passed, Failed, or Probational.</p>
                </div>
                <p>Make sure you're prepared to demonstrate what you've learned!</p>
                <br/>
                <p>Best regards,<br/>Apex Financial Team</p>
              </div>
            `,
          });
        } catch (e) {
          console.error(`Failed to email agent ${agentEmail}:`, e);
        }
      }

      // Send to manager
      if (managerEmail) {
        try {
          await resend.emails.send({
            from: "Apex Financial <notifications@apex-financial.org>",
            to: [managerEmail],
            subject: `🎯 Evaluation Due: ${agentName}`,
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #3b82f6;">Agent Evaluation Required</h2>
                <p>Hi ${managerName || "Manager"},</p>
                <p>Your agent <strong>${agentName}</strong> has completed ${daysInTraining} days of field training and is due for evaluation.</p>
                <div style="background: #f3f4f6; padding: 16px; border-radius: 8px; margin: 16px 0;">
                  <p style="margin: 0;"><strong>Action Required:</strong></p>
                  <p style="margin: 8px 0 0 0;">Please log into the CRM and record their evaluation result (Passed, Failed, or Probational).</p>
                </div>
                <br/>
                <p>Best regards,<br/>Apex Financial</p>
              </div>
            `,
          });
        } catch (e) {
          console.error(`Failed to email manager ${managerEmail}:`, e);
        }
      }

      // Send to admin
      try {
        await resend.emails.send({
          from: "Apex Financial <notifications@apex-financial.org>",
          to: ["info@apex-financial.org"],
          subject: `[Admin] Evaluation Due: ${agentName} (${daysInTraining} days)`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #8b5cf6;">Evaluation Due Alert</h2>
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>Agent:</strong></td>
                  <td style="padding: 8px; border-bottom: 1px solid #ddd;">${agentName}</td>
                </tr>
                <tr>
                  <td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>Days in Training:</strong></td>
                  <td style="padding: 8px; border-bottom: 1px solid #ddd;">${daysInTraining}</td>
                </tr>
                <tr>
                  <td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>Manager:</strong></td>
                  <td style="padding: 8px; border-bottom: 1px solid #ddd;">${managerName || "Unassigned"}</td>
                </tr>
              </table>
            </div>
          `,
        });
      } catch (e) {
        console.error("Failed to email admin:", e);
      }

      notifiedCount++;
    }

    console.log(`Evaluation due notifications sent for ${notifiedCount} agents`);

    return new Response(
      JSON.stringify({ success: true, notified: notifiedCount }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: any) {
    console.error("Error in notify-evaluation-due:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);
