import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) {
      return new Response(
        JSON.stringify({ error: "Resend not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get all unlicensed applicants not terminated
    const { data: applicants, error } = await supabase
      .from("applications")
      .select("id, first_name, last_name, email, license_status, state")
      .neq("license_status", "licensed")
      .is("terminated_at", null);

    if (error) throw error;

    console.log(`[Bulk Outreach] Found ${applicants?.length || 0} unlicensed applicants`);

    let sentCount = 0;
    const scheduleUrl = "https://rebuild-brighten-sparkle.lovable.app/schedule";
    const applyUrl = "https://rebuild-brighten-sparkle.lovable.app/apply";

    for (const app of applicants || []) {
      if (!app.email) continue;

      const firstName = app.first_name || "Future Agent";
      const safeFirst = firstName.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

      const emailHtml = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background-color:#f5f5f5;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f5f5;padding:40px 20px;">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:500px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.1);">

<tr><td style="background:linear-gradient(135deg,#D4AF37,#C5A028);padding:30px;text-align:center;">
<h1 style="margin:0;color:#000;font-size:22px;font-weight:bold;">Hey ${safeFirst}, Let's Get You Started! 🚀</h1>
</td></tr>

<tr><td style="padding:30px;">
<p style="color:#333;font-size:16px;line-height:1.6;margin:0 0 16px;">
Our average agent does <strong>$20,000 in production within their first month</strong>. Here's how to get started:
</p>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8f9fa;border-radius:8px;margin-bottom:20px;">
<tr><td style="padding:20px;">
<p style="margin:0 0 8px;color:#333;font-size:14px;"><strong>Step 1:</strong> Get your life insurance license (we guide you through it)</p>
<p style="margin:0 0 8px;color:#333;font-size:14px;"><strong>Step 2:</strong> Complete our virtual sales bootcamp</p>
<p style="margin:0;color:#333;font-size:14px;"><strong>Step 3:</strong> Start working unlimited warm leads</p>
</td></tr>
</table>

<p style="color:#333;font-size:14px;line-height:1.6;margin:0 0 24px;">
We provide <strong>free CRM, free dialer, 50+ carrier contracts</strong>, and 72-hour commission payouts. Everything you need to succeed.
</p>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
<tr>
<td width="48%" style="padding-right:4px;">
<a href="${scheduleUrl}" style="display:block;background:#D4AF37;color:#000;font-size:14px;font-weight:700;text-decoration:none;padding:14px 0;border-radius:8px;text-align:center;max-width:100%;box-sizing:border-box;">
📅 Schedule a Call
</a>
</td>
<td width="48%" style="padding-left:4px;">
<a href="${applyUrl}" style="display:block;background:#22c55e;color:#fff;font-size:14px;font-weight:700;text-decoration:none;padding:14px 0;border-radius:8px;text-align:center;max-width:100%;box-sizing:border-box;">
Apply Now →
</a>
</td>
</tr>
</table>
</td></tr>

<tr><td style="background-color:#1a1a1a;padding:20px;text-align:center;">
<p style="margin:0;color:#888;font-size:12px;">Apex Financial Enterprises</p>
</td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;

      try {
        const response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: "APEX Financial <noreply@apex-financial.org>",
            to: [app.email],
            cc: ["info@apex-financial.org"],
            subject: `${safeFirst}, Your $20K/Month Opportunity Awaits 🚀`,
            html: emailHtml,
          }),
        });

        if (response.ok) {
          sentCount++;
        } else {
          console.error(`Failed to send to ${app.email}:`, await response.text());
        }
      } catch (emailErr) {
        console.error(`Error sending to ${app.email}:`, emailErr);
      }

      // Rate limit
      await new Promise(resolve => setTimeout(resolve, 300));
    }

    console.log(`[Bulk Outreach] ✅ Sent ${sentCount}/${applicants?.length || 0} emails`);

    return new Response(
      JSON.stringify({ success: true, sent: sentCount, total: applicants?.length || 0 }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("[Bulk Outreach] Error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
