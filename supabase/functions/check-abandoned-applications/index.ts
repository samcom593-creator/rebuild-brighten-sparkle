import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const resendApiKey = Deno.env.get("RESEND_API_KEY");

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

const resend = resendApiKey ? new Resend(resendApiKey) : null;

const DASHBOARD_URL = "https://apex-financial.org";

// Sanitize string for HTML output
function sanitizeHtml(str: string | null | undefined): string {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (!resend) {
      console.warn("RESEND_API_KEY not configured");
      return new Response(
        JSON.stringify({ error: "Email service not configured" }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Find partial applications that are:
    // - More than 15 minutes old (quick detection of abandonment)
    // - Not converted (converted_at IS NULL)
    // - Not already notified (admin_notified_at IS NULL)
    // - Have at least email or phone (Step 1 completed)
    const fifteenMinsAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();

    const { data: abandonedLeads, error: fetchError } = await supabaseAdmin
      .from("partial_applications")
      .select("*")
      .lt("created_at", fifteenMinsAgo)
      .is("converted_at", null)
      .is("admin_notified_at", null)
      .or("email.neq.,phone.neq.")
      .order("created_at", { ascending: true })
      .limit(50);

    if (fetchError) {
      console.error("Error fetching abandoned applications:", fetchError);
      throw fetchError;
    }

    if (!abandonedLeads || abandonedLeads.length === 0) {
      console.log("No abandoned applications to process");
      return new Response(
        JSON.stringify({ message: "No abandoned applications found", processed: 0 }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    console.log(`Found ${abandonedLeads.length} abandoned applications`);

    // Build the email content with all abandoned leads
    const leadsTable = abandonedLeads.map((lead) => `
      <tr style="border-bottom: 1px solid #e5e7eb;">
        <td style="padding: 12px 8px; font-weight: 500;">
          ${sanitizeHtml(lead.first_name || "Unknown")} ${sanitizeHtml(lead.last_name || "")}
        </td>
        <td style="padding: 12px 8px;">
          ${lead.email ? `<a href="mailto:${lead.email}" style="color: #059669;">${sanitizeHtml(lead.email)}</a>` : "-"}
        </td>
        <td style="padding: 12px 8px;">
          ${lead.phone ? `<a href="tel:${lead.phone}" style="color: #059669;">${sanitizeHtml(lead.phone)}</a>` : "-"}
        </td>
        <td style="padding: 12px 8px;">
          ${sanitizeHtml(lead.city || "")}${lead.city && lead.state ? ", " : ""}${sanitizeHtml(lead.state || "")}
        </td>
        <td style="padding: 12px 8px; color: #dc2626;">
          Step ${lead.step_completed || 1}/4
        </td>
        <td style="padding: 12px 8px; color: #6b7280; font-size: 12px;">
          ${new Date(lead.created_at).toLocaleString('en-US', { 
            month: 'short', 
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          })}
        </td>
      </tr>
    `).join("");

    // Send admin notification email
    await resend.emails.send({
      from: "APEX Alerts <alerts@apex-financial.org>",
      to: ["info@apex-financial.org"],
      subject: `⚠️ ${abandonedLeads.length} Abandoned Application${abandonedLeads.length > 1 ? "s" : ""} - Follow Up Required`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #f59e0b, #d97706); padding: 30px; border-radius: 10px 10px 0 0;">
            <h1 style="color: white; margin: 0; font-size: 24px;">⚠️ Abandoned Applications Alert</h1>
            <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0;">
              ${abandonedLeads.length} potential lead${abandonedLeads.length > 1 ? "s" : ""} started but didn't complete the application
            </p>
          </div>
          
          <div style="background: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px;">
            <div style="background: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px 20px; margin-bottom: 20px; border-radius: 0 8px 8px 0;">
              <p style="margin: 0; color: #92400e; font-weight: 500;">
                These leads showed interest but abandoned the form. Consider reaching out to help them complete the process!
              </p>
            </div>

            <div style="background: white; border-radius: 8px; overflow: hidden; border: 1px solid #e5e7eb;">
              <table style="width: 100%; border-collapse: collapse;">
                <thead>
                  <tr style="background: #f9fafb;">
                    <th style="padding: 12px 8px; text-align: left; font-weight: 600; color: #374151;">Name</th>
                    <th style="padding: 12px 8px; text-align: left; font-weight: 600; color: #374151;">Email</th>
                    <th style="padding: 12px 8px; text-align: left; font-weight: 600; color: #374151;">Phone</th>
                    <th style="padding: 12px 8px; text-align: left; font-weight: 600; color: #374151;">Location</th>
                    <th style="padding: 12px 8px; text-align: left; font-weight: 600; color: #374151;">Progress</th>
                    <th style="padding: 12px 8px; text-align: left; font-weight: 600; color: #374151;">Started</th>
                  </tr>
                </thead>
                <tbody>
                  ${leadsTable}
                </tbody>
              </table>
            </div>

            <div style="text-align: center; margin-top: 25px;">
              <a href="${DASHBOARD_URL}/dashboard/admin" style="display: inline-block; background: linear-gradient(135deg, #059669 0%, #047857 100%); color: white; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600; font-size: 16px;">
                View Admin Dashboard →
              </a>
              <p style="color: #6b7280; font-size: 12px; margin-top: 15px;">
                Generated on ${new Date().toLocaleString('en-US', { 
                  weekday: 'long', 
                  year: 'numeric', 
                  month: 'long', 
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit'
                })}
              </p>
            </div>
          </div>
        </div>
      `,
    });

    console.log("Abandoned applications alert sent to admin");

    // Mark all these leads as notified
    const leadIds = abandonedLeads.map((lead) => lead.id);
    const { error: updateError } = await supabaseAdmin
      .from("partial_applications")
      .update({ admin_notified_at: new Date().toISOString() })
      .in("id", leadIds);

    if (updateError) {
      console.error("Error updating notified status:", updateError);
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        processed: abandonedLeads.length,
        message: `Sent alert for ${abandonedLeads.length} abandoned applications`
      }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: any) {
    console.error("Error in check-abandoned-applications:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);
