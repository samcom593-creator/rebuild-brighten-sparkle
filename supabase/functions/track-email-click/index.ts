import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";

const handler = async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  const email = url.searchParams.get("email") || "";
  const name = url.searchParams.get("name") || "Unknown";
  const source = url.searchParams.get("source") || "unknown";

  const redirectUrl = "https://rebuild-brighten-sparkle.lovable.app/apply";

  try {
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Log the click in email_tracking
    await supabaseClient.from("email_tracking").insert({
      email_type: "aged_lead_click",
      recipient_email: email || "unknown",
      metadata: { name, source, clicked_at: new Date().toISOString() },
    });

    // Look up lead info for admin notification
    let phone = "";
    if (email) {
      const { data: leadData } = await supabaseClient
        .from("aged_leads")
        .select("phone, last_name")
        .eq("email", email)
        .limit(1)
        .maybeSingle();

      if (leadData?.phone) phone = leadData.phone;
    }

    // Send admin notification
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (resendApiKey) {
      const resend = new Resend(resendApiKey);
      await resend.emails.send({
        from: "APEX Alerts <notifications@tx.apex-financial.org>",
        to: ["sam@apex-financial.org"],
        subject: `🔔 ${name} just clicked REAPPLY from aged lead email`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:500px;padding:20px;">
            <h2 style="color:#14b8a6;margin:0 0 16px 0;">Lead Re-Engaged! 🎯</h2>
            <p style="font-size:16px;margin:0 0 20px 0;color:#333;">
              <strong>${name}</strong> just clicked "REAPPLY NOW" from the aged lead outreach email.
            </p>
            <table style="border-collapse:collapse;width:100%;margin-bottom:20px;">
              <tr>
                <td style="padding:8px 12px;background:#f3f4f6;font-weight:bold;border-radius:4px 0 0 0;">Name</td>
                <td style="padding:8px 12px;background:#f9fafb;border-radius:0 4px 0 0;">${name}</td>
              </tr>
              <tr>
                <td style="padding:8px 12px;background:#f3f4f6;font-weight:bold;">Email</td>
                <td style="padding:8px 12px;background:#f9fafb;">${email ? `<a href="mailto:${email}">${email}</a>` : "N/A"}</td>
              </tr>
              <tr>
                <td style="padding:8px 12px;background:#f3f4f6;font-weight:bold;border-radius:0 0 0 4px;">Phone</td>
                <td style="padding:8px 12px;background:#f9fafb;border-radius:0 0 4px 0;">${phone ? `<a href="tel:${phone}">${phone}</a>` : "N/A"}</td>
              </tr>
            </table>
            <p style="font-size:14px;color:#6b7280;">Source: ${source} · Give them a call now!</p>
            <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;" />
            <p style="font-size:12px;color:#9ca3af;">Powered by Apex Financial</p>
          </div>
        `,
      });
      console.log(`Admin notified about click from ${name} (${email})`);
    }
  } catch (error) {
    console.error("Error tracking email click:", error);
    // Don't block the redirect on errors
  }

  // Always redirect to apply page
  return new Response(null, {
    status: 302,
    headers: { Location: redirectUrl },
  });
};

serve(handler);
