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
    const { agentId, result } = await req.json();

    if (!agentId || !result) {
      throw new Error("Agent ID and result are required");
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
      .select("full_name, email")
      .eq("user_id", agent.user_id)
      .single();

    // Get manager's profile
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

    const resultConfig = {
      passed: {
        color: "#22c55e",
        title: "Congratulations! You Passed!",
        message: "You have successfully completed your field training evaluation. You are now a fully trained agent ready to sell independently.",
        emoji: "🎉",
      },
      failed: {
        color: "#ef4444",
        title: "Evaluation Result: Not Passed",
        message: "Unfortunately, you did not pass this evaluation. Please speak with your manager about next steps and areas for improvement.",
        emoji: "📋",
      },
      probational: {
        color: "#f59e0b",
        title: "Probational Pass",
        message: "You have received a probational pass. You can continue but will need additional monitoring and may require a follow-up evaluation.",
        emoji: "⚡",
      },
    };

    const config = resultConfig[result as keyof typeof resultConfig];

    // Send email to agent
    if (agentEmail) {
      await resend.emails.send({
        from: "Apex Financial <notifications@tx.apex-financial.org>",
        to: [agentEmail],
        subject: `${config.emoji} Field Training Evaluation Result`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: ${config.color};">${config.title}</h2>
            <p>Hi ${agentName},</p>
            <p>${config.message}</p>
            ${result === "passed" ? `
              <p>Here's what's next:</p>
              <ul>
                <li>Continue attending team meetings</li>
                <li>Start taking on your own clients</li>
                <li>Reach out to your manager if you need support</li>
              </ul>
            ` : ""}
            <br/>
            <p>Best regards,<br/>Apex Financial Team</p>
          </div>
        `,
      });
    }

    // Send email to manager
    if (managerEmail) {
      await resend.emails.send({
        from: "Apex Financial <notifications@tx.apex-financial.org>",
        to: [managerEmail],
        subject: `Evaluation Complete: ${agentName} - ${result.toUpperCase()}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: ${config.color};">Evaluation Recorded</h2>
            <p>Hi ${managerName || "Manager"},</p>
            <p>An evaluation has been recorded for your agent:</p>
            <ul>
              <li><strong>Agent:</strong> ${agentName}</li>
              <li><strong>Result:</strong> <span style="color: ${config.color};">${result.toUpperCase()}</span></li>
            </ul>
            ${result !== "passed" ? `<p>Please follow up with ${agentName} to discuss next steps.</p>` : ""}
            <br/>
            <p>Best regards,<br/>Apex Financial</p>
          </div>
        `,
      });
    }

    // Send email to admin
    await resend.emails.send({
      from: "Apex Financial <notifications@tx.apex-financial.org>",
      to: ["sam@apex-financial.org"],
      subject: `[Admin] Evaluation: ${agentName} - ${result.toUpperCase()}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: ${config.color};">Agent Evaluation Recorded</h2>
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>Agent:</strong></td>
              <td style="padding: 8px; border-bottom: 1px solid #ddd;">${agentName}</td>
            </tr>
            <tr>
              <td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>Email:</strong></td>
              <td style="padding: 8px; border-bottom: 1px solid #ddd;">${agentEmail}</td>
            </tr>
            <tr>
              <td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>Manager:</strong></td>
              <td style="padding: 8px; border-bottom: 1px solid #ddd;">${managerName || "Unassigned"}</td>
            </tr>
            <tr>
              <td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>Result:</strong></td>
              <td style="padding: 8px; border-bottom: 1px solid #ddd; color: ${config.color};">${result.toUpperCase()}</td>
            </tr>
          </table>
        </div>
      `,
    });

    console.log(`Evaluation notifications sent for agent ${agentId} - ${result}`);

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: any) {
    console.error("Error in notify-evaluation-result:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);
