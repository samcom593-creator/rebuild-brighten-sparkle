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

        // Remove the agent from the active roster.
        //
        // MP-353: this wrote `deactivation_reason: "removed_from_system" as any`.
        // That is not a member of the deactivation_reason enum (bad_business /
        // inactive / switched_teams), so Postgres refused the whole UPDATE with
        // 22P02 — proven live: select 'removed_from_system'::deactivation_reason
        // -> invalid input value for enum.
        //
        // The cast is gone, but do NOT read that as type safety restored: this
        // was measured, and `deno check` still passes on the bad literal with
        // no cast at all, because createClient() here carries no Database
        // generic, so every .update() payload is `any`. Edge functions have no
        // type coverage of DB payloads — which is why this and its two
        // need_follow_up siblings survived. check:enum-filter-literals is the
        // only thing that catches this class under supabase/functions.
        //
        // MP-344 baselined this as needing "a product decision about which
        // member to use". That was refuted by the tree: DeactivateAgentDialog
        // handles the SAME "remove_from_system" action for an admin at :153-167
        // and already writes this exact state. The email-approval path is the
        // non-admin mirror of that branch, so it must land the same end state —
        // no migration and no new decision. The dialog also sets status and
        // is_inactive, which this path never did, so the two halves of one
        // button disagreed even in the world where the enum write succeeded.
        const { error: deactivateError } = await supabase
          .from("agents")
          .update({
            status: "terminated",
            is_deactivated: true,
            is_inactive: true,
            deactivation_reason: "inactive",
            updated_at: new Date().toISOString(),
          })
          .eq("id", request.agent_id);

        // The error was discarded, and the next statement marked the request
        // `approved` regardless — so a refused removal left the agent fully
        // active, cleared the request out of the pending queue, and told the
        // human "✅ ... has been removed from the system". Fake success on a
        // human-in-the-loop path. Refuse loudly instead, and leave the request
        // `pending` so the approval link still works once the cause is fixed.
        if (deactivateError) {
          console.error("Agent deactivation failed; leaving request pending:", deactivateError);
          return new Response(
            `<html>
            <head><style>body{font-family:system-ui;padding:40px;text-align:center;}</style></head>
            <body>
              <h1>Removal NOT applied</h1>
              <p>The agent is still active and this request is still pending.</p>
              <p><code>${deactivateError.message}</code></p>
            </body>
          </html>`,
            { headers: { ...corsHeaders, "Content-Type": "text/html" }, status: 500 }
          );
        }

        // Update the request status
        const { error: resolveError } = await supabase
          .from("agent_removal_requests")
          .update({ 
            status: "approved", 
            resolved_at: new Date().toISOString() 
          })
          .eq("id", requestId);

        // The agent IS removed at this point, so this is not a failure of the
        // removal — but a silent miss here leaves the request pending forever
        // and a second click would re-run an already-applied update. Say so
        // rather than folding it into the success page.
        if (resolveError) {
          console.error("Agent removed but request not marked approved:", resolveError);
          return new Response(
            `<html>
            <head><style>body{font-family:system-ui;padding:40px;text-align:center;}</style></head>
            <body>
              <h1>Agent removed — request not closed</h1>
              <p>The agent was removed from the active roster, but this request could not be marked approved.</p>
              <p><code>${resolveError.message}</code></p>
            </body>
          </html>`,
            { headers: { ...corsHeaders, "Content-Type": "text/html" }, status: 500 }
          );
        }

        return new Response(
          `<html>
            <head><style>body{font-family:system-ui;padding:40px;text-align:center;}</style></head>
            <body>
              <h1>✅ Agent Removal Approved</h1>
              <p>The agent has been removed from the active roster. Production, notes, training and audit history are preserved.</p>
              <p>You can close this window.</p>
            </body>
          </html>`,
          { headers: { ...corsHeaders, "Content-Type": "text/html" } }
        );
      } else if (action === "deny") {
        // Same discarded-error shape as the approve branch above. The page's
        // claim ("the agent will remain in the system") stays true whatever
        // happens here, so this is the quieter half — but a silent miss leaves
        // the request `pending` while telling the human it was denied, and it
        // reappears in the queue with no explanation.
        const { error: denyError } = await supabase
          .from("agent_removal_requests")
          .update({ 
            status: "denied", 
            resolved_at: new Date().toISOString() 
          })
          .eq("id", requestId);

        if (denyError) {
          console.error("Deny failed; request left pending:", denyError);
          return new Response(
            `<html>
            <head><style>body{font-family:system-ui;padding:40px;text-align:center;}</style></head>
            <body>
              <h1>Not recorded</h1>
              <p>The agent remains in the system, but this request could not be marked denied and is still pending.</p>
              <p><code>${denyError.message}</code></p>
            </body>
          </html>`,
            { headers: { ...corsHeaders, "Content-Type": "text/html" }, status: 500 }
          );
        }

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
      from: "APEX Team <notifications@apex-financial.org>",
      to: ["info@kingofsales.net"],
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
              Approving removes the agent from the active roster. Production, notes, training and audit history are preserved.
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
