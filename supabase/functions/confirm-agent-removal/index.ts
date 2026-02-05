import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RemovalRequest {
  agentId: string;
  agentName: string;
  reason?: string;
  requestedBy: string;
  requestedByName: string;
}

interface ConfirmRequest {
  requestId: string;
  action: "approve" | "deny";
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const url = new URL(req.url);
    const action = url.searchParams.get("action");
    const requestId = url.searchParams.get("requestId");

    // Handle confirmation from email link
    if (action && requestId) {
      console.log(`Processing ${action} for request ${requestId}`);

      if (action === "approve") {
        // Get the request details
        const { data: request, error: fetchError } = await supabase
          .from("agent_removal_requests")
          .select("*")
          .eq("id", requestId)
          .single();

        if (fetchError || !request) {
          return new Response(
            `<html><body><h1>Request not found or already processed</h1></body></html>`,
            { headers: { ...corsHeaders, "Content-Type": "text/html" }, status: 404 }
          );
        }

        if (request.status !== "pending") {
          return new Response(
            `<html><body><h1>This request has already been ${request.status}</h1></body></html>`,
            { headers: { ...corsHeaders, "Content-Type": "text/html" }, status: 400 }
          );
        }

        // Deactivate the agent
        await supabase
          .from("agents")
          .update({ 
            is_deactivated: true, 
            deactivation_reason: "removed_from_system" as any
          })
          .eq("id", request.agent_id);

        // Update the request status
        await supabase
          .from("agent_removal_requests")
          .update({ 
            status: "approved", 
            resolved_at: new Date().toISOString() 
          })
          .eq("id", requestId);

        return new Response(
          `<html>
            <head><style>body{font-family:system-ui;padding:40px;text-align:center;}</style></head>
            <body>
              <h1>✅ Agent Removal Approved</h1>
              <p>The agent has been removed from the system.</p>
              <p>You can close this window.</p>
            </body>
          </html>`,
          { headers: { ...corsHeaders, "Content-Type": "text/html" } }
        );
      } else if (action === "deny") {
        await supabase
          .from("agent_removal_requests")
          .update({ 
            status: "denied", 
            resolved_at: new Date().toISOString() 
          })
          .eq("id", requestId);

        return new Response(
          `<html>
            <head><style>body{font-family:system-ui;padding:40px;text-align:center;}</style></head>
            <body>
              <h1>❌ Removal Request Denied</h1>
              <p>The agent will remain in the system.</p>
              <p>You can close this window.</p>
            </body>
          </html>`,
          { headers: { ...corsHeaders, "Content-Type": "text/html" } }
        );
      }
    }

    // Handle new removal request
    const body: RemovalRequest = await req.json();
    console.log("Creating removal request:", body);

    // Create the removal request
    const { data: request, error: insertError } = await supabase
      .from("agent_removal_requests")
      .insert({
        agent_id: body.agentId,
        requested_by: body.requestedBy,
        reason: body.reason || "No reason provided",
      })
      .select()
      .single();

    if (insertError) {
      console.error("Error creating removal request:", insertError);
      throw insertError;
    }

    // Send confirmation email to admin
    const confirmUrl = `${supabaseUrl}/functions/v1/confirm-agent-removal?action=approve&requestId=${request.id}`;
    const denyUrl = `${supabaseUrl}/functions/v1/confirm-agent-removal?action=deny&requestId=${request.id}`;

    const emailResponse = await resend.emails.send({
      from: "APEX Team <noreply@apex-financial.org>",
      to: ["info@apex-financial.org"],
      subject: `🗑️ Agent Removal Request: ${body.agentName}`,
      html: `
        <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #dc2626, #b91c1c); color: white; padding: 20px; border-radius: 12px 12px 0 0; text-align: center;">
            <h1 style="margin: 0; font-size: 24px;">🗑️ Agent Removal Request</h1>
          </div>
          
          <div style="background: #f8fafc; padding: 24px; border: 1px solid #e2e8f0;">
            <h2 style="color: #1e293b; margin-top: 0;">Agent Details</h2>
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 8px 0; color: #64748b;">Agent Name:</td>
                <td style="padding: 8px 0; font-weight: bold; color: #1e293b;">${body.agentName}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #64748b;">Requested By:</td>
                <td style="padding: 8px 0; color: #1e293b;">${body.requestedByName}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #64748b;">Reason:</td>
                <td style="padding: 8px 0; color: #1e293b;">${body.reason || "No reason provided"}</td>
              </tr>
            </table>
            
            <div style="margin-top: 24px; text-align: center;">
              <a href="${confirmUrl}" style="display: inline-block; background: #dc2626; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold; margin-right: 12px;">
                ✅ Approve Removal
              </a>
              <a href="${denyUrl}" style="display: inline-block; background: #6b7280; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold;">
                ❌ Deny Request
              </a>
            </div>
            
            <p style="color: #64748b; font-size: 12px; margin-top: 24px; text-align: center;">
              This action will permanently remove the agent from the system.
            </p>
          </div>
        </div>
      `,
    });

    console.log("Email sent:", emailResponse);

    return new Response(
      JSON.stringify({ success: true, requestId: request.id }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Error in confirm-agent-removal:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
};

serve(handler);
