import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
// 2026-08-14: dead at boot on 2.50.0 — esm.sh resolves transitive deps at
// request time so the pin pinned nothing underneath; same WORKER_ERROR class
// and same fix as submit-contracting-intake (63fcf739).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ADMIN_EMAIL = "info@kingofsales.net";

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
  portalLink?: string;
  contractingLink?: string;
  licenseStatus?: "licensed" | "unlicensed" | "pending";
}

const defaultCourseLink = "https://partners.xcelsolutions.com/afe";
const PORTAL_LINK = "https://apex-financial.org/agent-portal";
const SLACK_LINK = "https://join.slack.com/t/apex-financial-co/shared_invite/zt-47rdeq1fr-ETmj8yGBgRcoYVkwfc3DBQ";
const DISCORD_LINK = "https://discord.gg/JpUWA73UZX";
const ONBOARDING_CALL_LINK = "https://calendly.com/apexfinancialempire/apex-onboarding-call";
const APEX_TRAINING_LINK = "https://apex-financial.org/dashboard/training/library";

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { agentName, agentEmail, agentId, managerId, courseLink, portalLink, contractingLink, licenseStatus }: WelcomeEmailRequest = await req.json();

    console.log(`Sending welcome email to ${agentName} at ${agentEmail}`);

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const isLicensed = licenseStatus === "licensed";

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

    const finalCourseLink = isLicensed ? APEX_TRAINING_LINK : (courseLink || defaultCourseLink);

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
    .slack-step { background: rgba(212, 175, 55, 0.1); border: 1px solid rgba(212, 175, 55, 0.35); padding: 20px; border-radius: 12px; margin: 20px 0; border-left: 4px solid #D4AF37; }
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
      
      <p>Welcome to the Apex Financial team. Your portal now shows a live roadmap, and these are your exact next steps:</p>

      <div class="slack-step">
        <h3 style="color:#D4AF37;"><span class="step-number" style="background:#D4AF37;color:#111;">1</span> Join the APEX Slack</h3>
        <p>This is the primary team workspace for daily huddles, contracting support, training, scripts, and sales wins.</p>
        <a href="${SLACK_LINK}" class="button" style="background:#D4AF37;color:#111 !important;">Join Team Slack →</a>
      </div>

      <div class="step" style="border-left-color:#5865F2;">
        <h3 style="color:#8b9cff;"><span class="step-number" style="background:#5865F2;">2</span> Join the APEX Discord</h3>
        <p>Use Discord for community access and direct licensing or contracting support.</p>
        <a href="${DISCORD_LINK}" class="button" style="background:#5865F2;">Join Team Discord →</a>
      </div>

      ${isLicensed ? `
      <div class="step" style="border-left-color:#D4AF37;">
        <h3 style="color:#D4AF37;"><span class="step-number" style="background:#D4AF37;color:#111;">3</span> Book With Milver</h3>
        <p>Milver Taca is your Contracting &amp; Onboarding Manager. Book the 30-minute call so your first-week plan and carrier setup are clear.</p>
        <a href="${ONBOARDING_CALL_LINK}" class="button" style="background:#D4AF37;color:#111 !important;">Book My Milver Call →</a>
      </div>
      <div class="step">
        <h3><span class="step-number">4</span> Set Up Your APEX Account</h3>
        <p>Sign in with your email, confirm your profile, and use the live roadmap as your source of truth.</p>
        <a href="${portalLink || PORTAL_LINK}" class="button">Open My Account &amp; Roadmap →</a>
      </div>
      <div class="step">
        <h3><span class="step-number">5</span> Complete Native APEX Contracting</h3>
        <p>Submit your NPN and profile once. APEX dispatches the contracting desk and spreadsheet automatically.</p>
        <a href="${contractingLink || "https://apex-financial.org/start-contracting"}" class="button">Complete Contracting →</a>
      </div>
      ` : `
      <div class="step">
        <h3><span class="step-number">3</span> Set Up Your APEX Account</h3>
        <p>Sign in with your email, confirm your profile, and open the live licensing roadmap.</p>
        <a href="${portalLink || PORTAL_LINK}" class="button">Open My Account &amp; Roadmap →</a>
      </div>
      <div class="step">
        <h3><span class="step-number">4</span> Create Your XCEL Course Account</h3>
        <p>Use the same legal name shown on your ID, then work the pre-licensing training in order.</p>
        <a href="${finalCourseLink}" class="button">Start Licensing →</a>
      </div>
      `}

      <div class="step">
        <h3><span class="step-number">${isLicensed ? '6' : '5'}</span> ${isLicensed ? 'Complete Online Training' : 'Complete the Licensing Roadmap'}</h3>
        <p>${isLicensed ? 'Finish the onboarding, script, objections, ReadyMode, pipeline, deal-posting, and underwriting walkthroughs before launch.' : 'Update course, exam, fingerprints, and license milestones as they happen. After your license posts, add your NPN and book onboarding.'}</p>
        <a href="${isLicensed ? finalCourseLink : PORTAL_LINK}" class="button">${isLicensed ? 'Start Training' : 'Open My Roadmap'} →</a>
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
        from: "APEX Financial <notifications@apex-financial.org>",
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
