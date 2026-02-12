import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ADMIN_EMAIL = "info@apex-financial.org";

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
  contractingLink?: string;
}

const defaultCourseLink = "https://partners.xcelsolutions.com/afe";
const PORTAL_LINK = "https://apex-financial.org/agent-portal";
const DISCORD_LINK = "https://discord.gg/GygkGEhb";

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { agentName, agentEmail, agentId, managerId, courseLink, contractingLink }: WelcomeEmailRequest = await req.json();

    console.log(`Sending welcome email to ${agentName} at ${agentEmail}`);

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    // Look up manager email for CC
    let managerEmail: string | null = null;
    if (managerId) {
      const { data: managerAgent } = await supabase
        .from("agents")
        .select("profile_id")
        .eq("id", managerId)
        .single();

      if (managerAgent?.profile_id) {
        const { data: managerProfile } = await supabase
          .from("profiles")
          .select("email")
          .eq("id", managerAgent.profile_id)
          .single();

        if (managerProfile?.email) {
          managerEmail = managerProfile.email;
        }
      }
    }

    // Build CC list (admin + manager, deduplicated)
    const ccList = [ADMIN_EMAIL, managerEmail]
      .filter(Boolean)
      .filter((v, i, a) => a.indexOf(v) === i) as string[];

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
    .highlight { background: linear-gradient(135deg, rgba(20, 184, 166, 0.2), rgba(14, 165, 233, 0.2)); padding: 20px; border-radius: 12px; margin: 20px 0; border: 1px solid rgba(20, 184, 166, 0.3); }
    .discord-step { background: rgba(88, 101, 242, 0.1); border: 1px solid rgba(88, 101, 242, 0.3); padding: 20px; border-radius: 12px; margin: 20px 0; border-left: 4px solid #5865F2; }
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
      
      <!-- Step 1: Start Contracting -->
      ${contractingLink ? `
      <div class="step" style="border-left-color: #f59e0b;">
        <h3 style="color: #f59e0b;"><span class="step-number" style="background:#f59e0b;">1</span> Start Your Contracting</h3>
        <p><strong style="color:#f59e0b;">⚡ FIRST PRIORITY:</strong> Click below to begin your contracting process. This is the most important step to get started.</p>
        <a href="${contractingLink}" class="button" style="background:#f59e0b;">Start Contracting →</a>
      </div>
      ` : ''}
      
      <!-- Step ${contractingLink ? '2' : '1'}: Portal -->
      <div class="step">
        <h3><span class="step-number">${contractingLink ? '2' : '1'}</span> Access Your Agent Portal</h3>
        <p>Your portal is where you'll log daily numbers, track performance, and see the leaderboard.</p>
        <a href="${PORTAL_LINK}" class="button">Open My Portal →</a>
      </div>
      
      <!-- Step ${contractingLink ? '3' : '2'}: Discord -->
      <div class="discord-step">
        <h3 style="color:#5865F2;"><span class="step-number" style="background:#5865F2;">${contractingLink ? '3' : '2'}</span> Join Our Team Discord</h3>
        <p>Connect with the team for daily training, support, and announcements.</p>
        <a href="${DISCORD_LINK}" class="button" style="background:#5865F2;">Join Discord →</a>
      </div>
      
      <!-- Step ${contractingLink ? '4' : '3'}: Coursework -->
      <div class="step">
        <h3><span class="step-number">${contractingLink ? '4' : '3'}</span> Complete Your Coursework</h3>
        <p>Complete the onboarding course to learn our systems and processes.</p>
        <p><strong style="color:#f59e0b;">Expectation: Complete this the same day you receive it.</strong></p>
        <a href="${finalCourseLink}" class="button">Start Coursework →</a>
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
        cc: ccList.length > 0 ? ccList : undefined,
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
    console.log("Welcome email sent successfully:", data, "CC:", ccList);

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
