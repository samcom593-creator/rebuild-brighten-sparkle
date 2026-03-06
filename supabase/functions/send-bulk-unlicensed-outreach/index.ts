import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ADMIN_EMAIL = "sam@apex-financial.org";

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
      .select("id, first_name, last_name, email, phone, license_status, license_progress, state, assigned_agent_id")
      .neq("license_status", "licensed")
      .is("terminated_at", null);

    if (error) throw error;

    const whatsappLink = Deno.env.get("WHATSAPP_GROUP_LINK") || "";
    console.log(`[Bulk Outreach] Found ${applicants?.length || 0} unlicensed applicants`);

    let sentCount = 0;
    let failedCount = 0;
    const scheduleUrl = "https://apex-financial.org/schedule";
    const licensingGuideUrl = "https://docs.google.com/document/d/1WBN_bh7Tl6IkhdXwQvrUa6Q58xmV9As_q048aKAeyNg/edit";
    const preLicensingUrl = "https://partners.xcelsolutions.com/afe";
    const licensingVideoUrl = "https://youtu.be/i1e5p-GEfAU";

    for (const app of applicants || []) {
      if (!app.email) continue;

      const firstName = app.first_name || "Future Agent";
      const safeFirst = firstName.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

      // Determine progress-specific messaging
      let progressNote = "";
      if (app.license_progress === "studying") {
        progressNote = `<p style="color:#333;font-size:14px;line-height:1.6;margin:0 0 16px;background:#e0f2fe;padding:12px;border-radius:8px;">📚 We see you're currently studying — keep it up! If you need help or have questions about the exam, book a quick call below.</p>`;
      } else if (app.license_progress === "exam_scheduled") {
        progressNote = `<p style="color:#333;font-size:14px;line-height:1.6;margin:0 0 16px;background:#dcfce7;padding:12px;border-radius:8px;">🎯 Your exam is scheduled — great progress! Let us know if you need any last-minute prep support.</p>`;
      } else {
        progressNote = `<p style="color:#333;font-size:14px;line-height:1.6;margin:0 0 16px;background:#fef3c7;padding:12px;border-radius:8px;">⏳ Haven't started your licensing yet? No worries — we'll walk you through every step. Book a call or check out the resources below!</p>`;
      }

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

${progressNote}

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

<!-- CTAs -->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
<tr>
<td width="48%" style="padding-right:4px;">
<a href="${scheduleUrl}" style="display:block;background:#D4AF37;color:#000;font-size:14px;font-weight:700;text-decoration:none;padding:14px 0;border-radius:8px;text-align:center;">
📅 Book a Call
</a>
</td>
<td width="48%" style="padding-left:4px;">
<a href="${preLicensingUrl}" style="display:block;background:#22c55e;color:#fff;font-size:14px;font-weight:700;text-decoration:none;padding:14px 0;border-radius:8px;text-align:center;">
📚 Start Licensing →
</a>
</td>
</tr>
</table>

<!-- Licensing Resources -->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f0f9ff;border:1px solid #bfdbfe;border-radius:8px;margin-bottom:16px;">
<tr><td style="padding:16px;">
<p style="color:#1e40af;font-weight:bold;font-size:14px;margin:0 0 8px;">📋 Licensing Resources</p>
<ul style="color:#333;font-size:13px;line-height:2;margin:0;padding-left:20px;">
<li><a href="${licensingVideoUrl}" style="color:#059669;">▶️ Watch: Licensing Overview Video</a></li>
<li><a href="${licensingGuideUrl}" style="color:#059669;">📄 Step-by-Step Licensing Guide</a></li>
<li><a href="${preLicensingUrl}" style="color:#059669;">📚 Pre-Licensing Course (XcelSolutions)</a></li>
</ul>
</td></tr>
</table>
</td></tr>

${whatsappLink ? `
<tr><td style="padding:0 30px 20px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:rgba(37,211,102,0.1);border:1px solid rgba(37,211,102,0.3);border-radius:8px;">
<tr><td style="padding:16px;text-align:center;">
<p style="color:#25D366;font-weight:bold;font-size:14px;margin:0 0 8px;">💬 Join Our WhatsApp Group</p>
<p style="color:#666;font-size:13px;margin:0 0 12px;">Connect with the team, get real-time support &amp; daily motivation</p>
<a href="${whatsappLink}" style="display:inline-block;background:#25D366;color:#fff;text-decoration:none;padding:10px 24px;border-radius:6px;font-weight:bold;font-size:14px;">Join WhatsApp →</a>
</td></tr>
</table>
</td></tr>
` : ''}

<!-- Need help banner -->
<tr><td style="padding:0 30px 20px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fef3c7;border:1px solid #fbbf24;border-radius:8px;">
<tr><td style="padding:16px;text-align:center;">
<p style="color:#92400e;font-weight:bold;font-size:14px;margin:0 0 8px;">🤝 Need Help?</p>
<p style="color:#78350f;font-size:13px;margin:0 0 12px;">Stuck on licensing? Have questions about the process? We're here for you!</p>
<a href="${scheduleUrl}" style="display:inline-block;background:#f59e0b;color:#000;text-decoration:none;padding:10px 24px;border-radius:6px;font-weight:bold;font-size:14px;">Schedule Support Call →</a>
</td></tr>
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
            from: "APEX Financial <notifications@tx.apex-financial.org>",
            to: [app.email],
            cc: [ADMIN_EMAIL],
            subject: `${safeFirst}, Your $20K/Month Opportunity Awaits 🚀`,
            html: emailHtml,
          }),
        });

        if (response.ok) {
          sentCount++;
        } else {
          failedCount++;
          console.error(`Failed to send to ${app.email}:`, await response.text());
        }
      } catch (emailErr) {
        failedCount++;
        console.error(`Error sending to ${app.email}:`, emailErr);
      }

      // Rate limit — 1.5s to stay under Resend 2/sec limit
      await new Promise(resolve => setTimeout(resolve, 1500));
    }

    console.log(`[Bulk Outreach] ✅ Sent ${sentCount}/${applicants?.length || 0} emails (${failedCount} failed)`);

    return new Response(
      JSON.stringify({ success: true, sent: sentCount, failed: failedCount, total: applicants?.length || 0 }),
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
