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

const APPLY_URL = "https://apex-financial.org/apply";
const CALENDLY_URL = "https://calendly.com/sam-com593/licensed-prospect-call-clone";
const ADMIN_EMAIL = "sam@apex-financial.org";

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

    const { partialApplicationId } = await req.json();

    if (!partialApplicationId) {
      return new Response(
        JSON.stringify({ error: "partialApplicationId is required" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Fetch the partial application
    const { data: lead, error: fetchError } = await supabaseAdmin
      .from("partial_applications")
      .select("*")
      .eq("id", partialApplicationId)
      .single();

    if (fetchError || !lead) {
      console.error("Error fetching partial application:", fetchError);
      return new Response(
        JSON.stringify({ error: "Lead not found" }),
        { status: 404, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    if (!lead.email) {
      return new Response(
        JSON.stringify({ error: "Lead has no email address" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const firstName = lead.first_name || "there";

    console.log(`Sending abandoned follow-up to ${lead.email}`);

    // Send re-engagement email with admin CC
    await resend.emails.send({
      from: "APEX Financial <notifications@apex-financial.org>",
      to: [lead.email],
      cc: [ADMIN_EMAIL],
      subject: `${sanitizeHtml(firstName)}, Still Interested in Joining APEX? 🚀`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #10b981, #059669); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 28px;">We Noticed You Started an Application!</h1>
          </div>
          
          <div style="background: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px;">
            <p style="font-size: 16px; color: #374151; line-height: 1.6;">
              Hey ${sanitizeHtml(firstName)}! 👋
            </p>
            
            <p style="font-size: 16px; color: #374151; line-height: 1.6;">
              We noticed you started your application to join APEX Financial but didn't get a chance to finish. 
              No worries – life gets busy! We wanted to reach out and see if you had any questions or if there's 
              anything we can help you with.
            </p>

            <div style="background: #ecfdf5; border-left: 4px solid #10b981; padding: 15px 20px; margin: 20px 0; border-radius: 0 8px 8px 0;">
              <p style="margin: 0; color: #065f46; font-weight: 500;">
                💡 Quick reminder: APEX agents earn uncapped commissions with no cold calling required. 
                We provide warm leads, training, and support!
              </p>
            </div>

            <p style="font-size: 16px; color: #374151; line-height: 1.6;">
              Ready to pick up where you left off? It only takes a few minutes to complete:
            </p>

            <div style="text-align: center; margin: 25px 0;">
              <a href="${APPLY_URL}" style="display: inline-block; background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px; max-width:100%; box-sizing:border-box;">
                Complete My Application →
              </a>
            </div>

            <p style="font-size: 16px; color: #374151; line-height: 1.6;">
              Have questions first? We'd love to chat! Schedule a quick call with our team:
            </p>

            <div style="text-align: center; margin: 20px 0;">
              <a href="${CALENDLY_URL}" style="display: inline-block; background: white; color: #059669; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-weight: 600; font-size: 14px; border: 2px solid #059669; max-width:100%; box-sizing:border-box;">
                📞 Schedule a Call
              </a>
            </div>

            <p style="font-size: 14px; color: #6b7280; line-height: 1.6; margin-top: 30px;">
              Looking forward to hearing from you!<br><br>
              Best,<br>
              <strong>The APEX Team</strong>
            </p>
          </div>
        </div>
      `,
    });

    console.log("Abandoned follow-up email sent successfully, CC: " + ADMIN_EMAIL);

    // Update the partial application to track the follow-up
    await supabaseAdmin
      .from("partial_applications")
      .update({ 
        updated_at: new Date().toISOString(),
        form_data: {
          ...lead.form_data,
          followup_sent_at: new Date().toISOString()
        }
      })
      .eq("id", partialApplicationId);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `Follow-up email sent to ${lead.email}`
      }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: any) {
    console.error("Error in send-abandoned-followup:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);
