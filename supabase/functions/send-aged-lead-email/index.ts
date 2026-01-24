import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const getEmailHtml = (firstName: string) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background-color:#0a0a0a;color:#ffffff;">
  <div style="max-width:600px;margin:0 auto;padding:40px 20px;">
    <div style="text-align:center;margin-bottom:32px;">
      <h1 style="font-size:28px;font-weight:bold;margin:0;background:linear-gradient(135deg,#14b8a6,#0ea5e9);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">APEX FINANCIAL</h1>
    </div>
    
    <div style="background:linear-gradient(145deg,#1a1a2e,#16213e);border-radius:16px;padding:32px;border:1px solid rgba(20,184,166,0.2);">
      <h2 style="font-size:24px;margin:0 0 16px 0;color:#14b8a6;">Hey ${firstName}!</h2>
      
      <p style="font-size:16px;line-height:1.6;color:#d1d5db;margin:0 0 16px 0;">
        It looks like you were interested in a remote high-ticket sales opportunity with Apex Financial and learning how to join a competitive brokerage.
      </p>
      
      <div style="background:rgba(20,184,166,0.1);border-radius:8px;padding:20px;margin:20px 0;">
        <p style="font-size:16px;color:#14b8a6;margin:0 0 12px 0;font-weight:bold;">What our new agents are earning:</p>
        <ul style="margin:0;padding-left:20px;color:#d1d5db;">
          <li style="margin-bottom:8px;"><strong style="color:#ffffff;">Starting income:</strong> $10,000+/month</li>
          <li style="margin-bottom:8px;"><strong style="color:#ffffff;">Top performers:</strong> $50,000+/month within 4 months</li>
        </ul>
      </div>
      
      <p style="font-size:16px;line-height:1.6;color:#d1d5db;margin:0 0 16px 0;">
        <strong style="color:#ffffff;">What's included:</strong>
      </p>
      <ul style="margin:0 0 20px 0;padding-left:20px;color:#d1d5db;">
        <li style="margin-bottom:8px;">✓ Free leads provided daily</li>
        <li style="margin-bottom:8px;">✓ Comprehensive training program</li>
        <li style="margin-bottom:8px;">✓ Free CRM access</li>
        <li style="margin-bottom:8px;">✓ Equity partnership opportunity</li>
        <li style="margin-bottom:8px;">✓ Work virtually or from the office</li>
      </ul>
      
      <p style="font-size:16px;line-height:1.6;color:#d1d5db;margin:0 0 24px 0;">
        We're now accepting applications. Here are your options:
      </p>
      
      <!-- CTA Buttons -->
      <div style="text-align:center;margin:32px 0;">
        <a href="https://rebuild-brighten-sparkle.lovable.app/apply" 
           style="display:inline-block;background:linear-gradient(135deg,#14b8a6,#0ea5e9);color:#ffffff;padding:16px 32px;text-decoration:none;border-radius:8px;font-weight:bold;font-size:16px;margin:8px;">
          Apply Now
        </a>
      </div>
      
      <div style="text-align:center;margin:20px 0;">
        <a href="https://rebuild-brighten-sparkle.lovable.app" 
           style="display:inline-block;color:#14b8a6;padding:12px 24px;text-decoration:none;border:1px solid #14b8a6;border-radius:8px;font-weight:bold;font-size:14px;margin:8px;">
          Learn More About Us
        </a>
      </div>
      
      <div style="text-align:center;margin:20px 0;">
        <a href="https://rebuild-brighten-sparkle.lovable.app/schedule-call" 
           style="display:inline-block;color:#ffffff;padding:12px 24px;text-decoration:none;border:1px solid rgba(255,255,255,0.3);border-radius:8px;font-size:14px;margin:8px;">
          📞 Schedule a Call
        </a>
      </div>
      
      <p style="font-size:14px;color:#9ca3af;margin:24px 0 0 0;">
        Looking forward to hearing from you,<br>
        <strong style="color:#ffffff;">The Apex Financial Team</strong>
      </p>
    </div>
    
    <p style="font-size:12px;color:#6b7280;text-align:center;margin-top:32px;">
      © ${new Date().getFullYear()} Apex Financial. All rights reserved.<br>
      <a href="https://rebuild-brighten-sparkle.lovable.app" style="color:#6b7280;">Visit our website</a>
    </p>
  </div>
</body>
</html>
`;

const handler = async (req: Request): Promise<Response> => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) {
      throw new Error("RESEND_API_KEY not configured");
    }

    const resend = new Resend(resendApiKey);

    const { email, firstName } = await req.json() as {
      email: string;
      firstName: string;
    };

    if (!email) {
      throw new Error("Missing required field: email");
    }

    const name = firstName || "there";
    const html = getEmailHtml(name);

    const { error: emailError } = await resend.emails.send({
      from: "Apex Financial <team@updates.apexlifeadvisors.com>",
      to: [email],
      subject: "Ready to restart your financial services career?",
      html,
    });

    if (emailError) {
      console.error("Error sending aged lead email:", emailError);
      throw new Error(`Failed to send email: ${emailError.message}`);
    }

    console.log(`Aged lead email sent successfully to ${email}`);

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: any) {
    console.error("Error in send-aged-lead-email:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);
