import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { requireSendAuth } from "../_shared/require-send-auth.ts";
import { escapeHtml } from "../_shared/notify-caller-policy.ts";
import { safeEqual } from "../_shared/send-floor.ts";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// PL-WIB-REMOVAL-APPROVAL-GATE (2026-10-15). The approve link terminates an
// agent, and until this change the only thing it checked was requestId. The
// POST that creates a request read no credential and returned that requestId
// in its response, so two anonymous requests (POST, then GET ?action=approve)
// removed any agent from the roster with no human in the loop. Agent ids are
// readable by any self-signup (MP-326), so "any agent" meant any of them.
//
// requestId is not a secret even with the POST gated: RLS lets a manager
// SELECT the requests they created, so a manager could approve their own.
// The link now carries an HMAC of the action and the request id under the
// service role key, which never leaves this environment. Only the email to
// info@kingofsales.net carries it.
async function linkToken(action: string, requestId: string, key: string): Promise<string> {
  const k = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    k,
    new TextEncoder().encode(`confirm-agent-removal:v1:${action}:${requestId.toLowerCase()}`),
  );
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

const htmlPage = (title: string, body: string, status: number) =>
  new Response(
    `<html><head><style>body{font-family:system-ui;padding:40px;text-align:center;}</style></head><body><h1>${title}</h1><p>${body}</p></body></html>`,
    { headers: { ...corsHeaders, "Content-Type": "text/html" }, status },
  );

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
      if ((action !== "approve" && action !== "deny") || !UUID_RE.test(requestId)) {
        return htmlPage("Invalid link", "This approval link is malformed.", 400);
      }
      // Verified before any read, so an unsigned link learns nothing about
      // whether the request exists.
      const token = url.searchParams.get("token") ?? "";
      const expected = await linkToken(action, requestId, supabaseServiceKey);
      if (!safeEqual(token, expected)) {
        return htmlPage("Invalid link", "This approval link is not valid. Use the link in the removal request email.", 403);
      }

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

    // Handle new removal request. Credential first, body second: the only
    // callers are DeactivateAgentDialog's non-admin branch on staff pages
    // (DashboardCRM, DashboardCommandCenter, TeamHierarchyManager); the admin
    // branch writes agents directly and never calls this.
    const auth = await requireSendAuth(req, { floor: "staff" });
    if (!auth.ok) {
      return new Response(
        JSON.stringify({ error: auth.error }),
        { status: auth.status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body: RemovalRequest = await req.json();
    if (!UUID_RE.test(String(body.agentId ?? ""))) {
      return new Response(
        JSON.stringify({ error: "agentId must be a uuid" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // The requester is whoever holds the token, not whoever the body names.
    // A service caller (none exist today) has no user, so it must name one.
    const requesterId = auth.caller?.startsWith("user:") ? auth.caller.slice(5) : String(body.requestedBy ?? "");
    if (!UUID_RE.test(requesterId)) {
      return new Response(
        JSON.stringify({ error: "requestedBy must be a uuid" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Names in the email come from the rows, so the email Sam approves from
    // says who is really being removed and who really asked.
    const { data: agentRows } = await supabase
      .from("agents")
      .select("display_name")
      .eq("id", body.agentId)
      .limit(1);
    if (!agentRows?.length) {
      return new Response(
        JSON.stringify({ error: "agent not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const { data: requesterRows } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("user_id", requesterId)
      .limit(1);
    const agentName = String(agentRows[0].display_name || body.agentName || "Unknown agent");
    const requesterName = String(requesterRows?.[0]?.full_name || body.requestedByName || "—");
    const reason = String(body.reason || "No reason provided");

    // Create the removal request
    const { data: request, error: insertError } = await supabase
      .from("agent_removal_requests")
      .insert({
        agent_id: body.agentId,
        requested_by: requesterId,
        reason,
      })
      .select()
      .single();

    if (insertError) {
      console.error("Error creating removal request:", insertError);
      throw insertError;
    }

    // Send confirmation email to admin
    const base = `${supabaseUrl}/functions/v1/confirm-agent-removal?requestId=${request.id}`;
    const confirmUrl = `${base}&action=approve&token=${await linkToken("approve", request.id, supabaseServiceKey)}`;
    const denyUrl = `${base}&action=deny&token=${await linkToken("deny", request.id, supabaseServiceKey)}`;

    const emailResponse = await resend.emails.send({
      from: "Galaxy Team <notifications@apex-financial.org>",
      to: ["info@kingofsales.net"],
      subject: `🗑️ Agent Removal Request: ${agentName.replace(/[\r\n]+/g, " ").slice(0, 120)}`,
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
                <td style="padding: 8px 0; font-weight: bold; color: #1e293b;">${escapeHtml(agentName)}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #64748b;">Requested By:</td>
                <td style="padding: 8px 0; color: #1e293b;">${escapeHtml(requesterName)}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #64748b;">Reason:</td>
                <td style="padding: 8px 0; color: #1e293b;">${escapeHtml(reason)}</td>
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

    // No requestId in the response: the requester must not hold anything that
    // reaches the approve branch. DeactivateAgentDialog reads only `error`.
    return new Response(
      JSON.stringify({ success: true }),
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
