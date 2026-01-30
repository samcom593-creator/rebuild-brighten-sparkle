import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface WelcomeEmailRequest {
  agentName: string;
  agentEmail: string;
  agentId?: string;
  managerId?: string;
  courseLink?: string;
}

const discordLink = "https://discord.gg/GygkGEhb";
const defaultCourseLink = "https://apex-financial.org/onboarding-course";

const handler = async (req: Request): Promise<Response> => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { agentName, agentEmail, agentId, managerId, courseLink }: WelcomeEmailRequest = await req.json();

    console.log(`Sending welcome email to ${agentName} at ${agentEmail}`);

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    // Try to get the manager's contracting link if managerId is provided
    let licensingLink = "https://apex-financial.org/get-licensed";
    if (managerId) {
      const { data: contractingLinks } = await supabase
        .from("contracting_links")
        .select("url, name")
        .eq("manager_id", managerId)
        .limit(1);
      
      if (contractingLinks && contractingLinks.length > 0) {
        licensingLink = contractingLinks[0].url;
      }
    }

    const finalCourseLink = courseLink || defaultCourseLink;

    const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #14b8a6 0%, #0ea5e9 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
    .content { background: #0a0a0a; color: #ffffff; padding: 30px; border-radius: 0 0 10px 10px; }
    .step { background: linear-gradient(145deg, #1a1a2e, #16213e); padding: 20px; border-radius: 12px; margin: 20px 0; border-left: 4px solid #14b8a6; }
    .step-number { display: inline-block; background: #14b8a6; color: white; width: 28px; height: 28px; border-radius: 50%; text-align: center; line-height: 28px; font-weight: bold; margin-right: 10px; }
    .button { display: inline-block; background: #14b8a6; color: white !important; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: bold; margin: 12px 0; }
    .warning { background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); padding: 15px; border-radius: 8px; margin: 15px 0; }
    .warning-icon { color: #f87171; font-weight: bold; }
    .highlight { background: linear-gradient(135deg, rgba(20, 184, 166, 0.2), rgba(14, 165, 233, 0.2)); padding: 20px; border-radius: 12px; margin: 20px 0; border: 1px solid rgba(20, 184, 166, 0.3); }
    .footer { text-align: center; margin-top: 20px; color: #6b7280; font-size: 14px; }
    h3 { color: #14b8a6; margin: 0 0 12px 0; }
    p { color: #d1d5db; margin: 0 0 12px 0; }
    strong { color: #ffffff; }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#0a0a0a;">
  <div class="container">
    <div class="header">
      <h1 style="margin:0;font-size:28px;">Welcome to APEX! 🎉</h1>
      <p style="margin:10px 0 0 0;opacity:0.9;">Let's build something great together</p>
    </div>
    <div class="content">
      <p style="font-size:18px;">Hey ${agentName},</p>
      
      <p>Welcome to the Apex Financial team! Follow these steps to get started:</p>
      
      <!-- Step 1: Licensing -->
      <div class="step">
        <h3><span class="step-number">1</span> Complete Your Licensing</h3>
        <p>If you're not already licensed, tap the link below to get started with your contracting:</p>
        <a href="${licensingLink}" class="button">Complete Licensing →</a>
        
        <div class="warning">
          <p style="margin:0;"><span class="warning-icon">⚠️ IMPORTANT:</span> Make sure to attach your <strong>E&O (Errors & Omissions) insurance</strong>.</p>
          <p style="margin:8px 0 0 0;font-size:14px;">This is a critical step - without it, your application won't process correctly.</p>
        </div>
      </div>
      
      <!-- Step 2: Coursework -->
      <div class="step">
        <h3><span class="step-number">2</span> Complete Your Coursework</h3>
        <p>Once you're set up, complete the onboarding course to learn our systems and processes.</p>
        <p><strong style="color:#f59e0b;">Expectation: Complete this the same day you receive it.</strong></p>
        <a href="${finalCourseLink}" class="button">Start Coursework →</a>
      </div>
      
      <!-- Step 3: Discord -->
      <div class="step">
        <h3><span class="step-number">3</span> Join Discord</h3>
        <p>All team communication happens here. This is where you'll connect with the team and get support.</p>
        <a href="${discordLink}" class="button" style="background:#5865F2;">Join Discord →</a>
        
        <p style="margin-top:15px;padding:12px;background:rgba(20,184,166,0.1);border-radius:8px;">
          <strong>Daily meetings at 10:00 AM CST</strong><br>
          Camera ON required • Remember: <span style="color:#f59e0b;">On time is LATE</span>
        </p>
      </div>
      
      <!-- Expectations -->
      <div class="highlight">
        <h3 style="text-align:center;">🏆 What We Expect</h3>
        <p style="text-align:center;font-size:16px;">
          At Apex, the standard is <strong>excellence</strong>.<br><br>
          Our minimum production standard is <strong style="font-size:22px;color:#14b8a6;">$20,000/month</strong>.<br><br>
          You were chosen because we believe you can hit that and beyond.
        </p>
      </div>
      
      <p style="text-align:center;margin-top:30px;">
        Let's build something great together!<br><br>
        <strong>— The Apex Team</strong>
      </p>
    </div>
    <div class="footer">
      <p>© ${new Date().getFullYear()} Apex Financial. All rights reserved.</p>
      <p style="font-size:12px;">Powered by Apex Financial</p>
    </div>
  </div>
</body>
</html>
    `;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: "APEX Financial <noreply@apex-financial.org>",
        to: [agentEmail],
        subject: "Welcome to Apex Financial! 🎉 Your First Steps",
        html: emailHtml,
      }),
    });

    if (!res.ok) {
      const error = await res.text();
      console.error("Resend API error:", error);
      throw new Error(`Failed to send email: ${error}`);
    }

    const data = await res.json();
    console.log("Welcome email sent successfully:", data);

    return new Response(JSON.stringify({ success: true, data }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders,
      },
    });
  } catch (error: any) {
    console.error("Error in welcome-new-agent function:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
};

serve(handler);
