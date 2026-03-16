import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { Resend } from "npm:resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ADMIN_EMAIL = "sam@apex-financial.org";

async function getManagerEmailFromAgent(supabase: any, agentId: string): Promise<string | null> {
  try {
    const { data: agent } = await supabase.from("agents").select("user_id, invited_by_manager_id").eq("id", agentId).single();
    if (!agent) return null;
    const managerId = agent.invited_by_manager_id || agentId;
    const { data: manager } = await supabase.from("agents").select("user_id").eq("id", managerId).single();
    if (!manager?.user_id) return null;
    const { data: authData } = await supabase.auth.admin.getUserById(manager.user_id);
    return authData?.user?.email || null;
  } catch (e) {
    console.error("Error resolving manager email:", e);
    return null;
  }
}

// Helper to build a mobile-safe CTA button using table layout
function ctaButton(href: string, text: string, bgColor: string = "#14b8a6"): string {
  return `
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
        <tr>
          <td align="center" style="padding:32px 0;">
            <table role="presentation" cellspacing="0" cellpadding="0">
              <tr>
                <td bgcolor="${bgColor}" style="border-radius:8px;">
                  <a href="${href}" style="display:inline-block;color:#ffffff;padding:16px 32px;text-decoration:none;font-weight:bold;font-size:16px;" target="_blank">
                    ${text}
                  </a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>`;
}

// Email templates
const emailTemplates = {
  cold_licensed: {
    subject: "Open to exploring a new opportunity?",
    getHtml: (firstName: string, agentName: string) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background-color:#0a0a0a;color:#ffffff;word-break:break-word;">
  <div style="max-width:600px;margin:0 auto;padding:40px 20px;">
    <div style="text-align:center;margin-bottom:32px;">
      <h1 style="font-size:28px;font-weight:bold;margin:0;background:linear-gradient(135deg,#14b8a6,#0ea5e9);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">APEX FINANCIAL</h1>
    </div>
    
    <div style="background:linear-gradient(145deg,#1a1a2e,#16213e);border-radius:16px;padding:32px;border:1px solid rgba(20,184,166,0.2);">
      <h2 style="font-size:24px;margin:0 0 16px 0;color:#14b8a6;">Hey ${firstName}!</h2>
      
      <p style="font-size:16px;line-height:1.6;color:#d1d5db;margin:0 0 16px 0;">
        I came across your profile and I'm impressed by your experience in the insurance industry.
      </p>
      
      <p style="font-size:16px;line-height:1.6;color:#d1d5db;margin:0 0 16px 0;">
        I wanted to reach out because we're building something special at Apex Financial—a team of elite advisors who are tired of the traditional agency model and want to truly own their career.
      </p>
      
      <p style="font-size:16px;line-height:1.6;color:#d1d5db;margin:0 0 24px 0;">
        <strong style="color:#ffffff;">Would you be open to a quick 15-minute call</strong> to explore if this might be a good fit? No pressure, just a conversation about where you're at and where you want to go.
      </p>
      
      ${ctaButton("https://calendly.com/apexlifeadvisors/15-minute-discovery", "Schedule a Call")}
      
      <p style="font-size:14px;color:#9ca3af;margin:24px 0 0 0;">
        Looking forward to connecting,<br>
        <strong style="color:#ffffff;">${agentName}</strong><br>
        Apex Financial
      </p>
    </div>
    
    <p style="font-size:12px;color:#6b7280;text-align:center;margin-top:32px;">
      © ${new Date().getFullYear()} Apex Financial. All rights reserved.
    </p>
  </div>
</body>
</html>
    `,
  },
  cold_unlicensed: {
    subject: "Let's chat about your progress!",
    getHtml: (firstName: string, agentName: string) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background-color:#0a0a0a;color:#ffffff;word-break:break-word;">
  <div style="max-width:600px;margin:0 auto;padding:40px 20px;">
    <div style="text-align:center;margin-bottom:32px;">
      <h1 style="font-size:28px;font-weight:bold;margin:0;background:linear-gradient(135deg,#14b8a6,#0ea5e9);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">APEX FINANCIAL</h1>
    </div>
    
    <div style="background:linear-gradient(145deg,#1a1a2e,#16213e);border-radius:16px;padding:32px;border:1px solid rgba(20,184,166,0.2);">
      <h2 style="font-size:24px;margin:0 0 16px 0;color:#14b8a6;">Hey ${firstName}!</h2>
      
      <p style="font-size:16px;line-height:1.6;color:#d1d5db;margin:0 0 16px 0;">
        I saw you started the process of exploring a career in financial services—that's awesome! Taking that first step shows you're serious about building something great.
      </p>
      
      <p style="font-size:16px;line-height:1.6;color:#d1d5db;margin:0 0 16px 0;">
        I wanted to check in and see where you're at. Whether you're still figuring things out or you're ready to dive deeper, I'd love to hop on a quick call to answer any questions.
      </p>
      
      <p style="font-size:16px;line-height:1.6;color:#d1d5db;margin:0 0 24px 0;">
        <strong style="color:#ffffff;">No sales pitch—just a real conversation</strong> about what this industry looks like and how you can start building income from day one.
      </p>
      
      ${ctaButton("https://calendly.com/apexlifeadvisors/15min", "Let's Talk")}
      
      <p style="font-size:14px;color:#9ca3af;margin:24px 0 0 0;">
        Here whenever you're ready,<br>
        <strong style="color:#ffffff;">${agentName}</strong><br>
        Apex Financial
      </p>
    </div>
    
    <p style="font-size:12px;color:#6b7280;text-align:center;margin-top:32px;">
      © ${new Date().getFullYear()} Apex Financial. All rights reserved.
    </p>
  </div>
</body>
</html>
    `,
  },
  followup1_licensed: {
    subject: "Great connecting—let's continue the conversation",
    getHtml: (firstName: string, agentName: string) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background-color:#0a0a0a;color:#ffffff;word-break:break-word;">
  <div style="max-width:600px;margin:0 auto;padding:40px 20px;">
    <div style="text-align:center;margin-bottom:32px;">
      <h1 style="font-size:28px;font-weight:bold;margin:0;background:linear-gradient(135deg,#14b8a6,#0ea5e9);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">APEX FINANCIAL</h1>
    </div>
    
    <div style="background:linear-gradient(145deg,#1a1a2e,#16213e);border-radius:16px;padding:32px;border:1px solid rgba(20,184,166,0.2);">
      <h2 style="font-size:24px;margin:0 0 16px 0;color:#14b8a6;">Hey ${firstName}!</h2>
      
      <p style="font-size:16px;line-height:1.6;color:#d1d5db;margin:0 0 16px 0;">
        Really enjoyed our conversation! I wanted to follow up while everything is still fresh.
      </p>
      
      <p style="font-size:16px;line-height:1.6;color:#d1d5db;margin:0 0 16px 0;">
        I think there's a lot of potential here, and I'd love to dive deeper into how Apex could help you hit your income goals while building a real business.
      </p>
      
      <p style="font-size:16px;line-height:1.6;color:#d1d5db;margin:0 0 24px 0;">
        <strong style="color:#ffffff;">When works best for a follow-up call?</strong> I want to walk you through our compensation structure and show you exactly what top producers are earning.
      </p>
      
      ${ctaButton("https://calendly.com/apexlifeadvisors/15-minute-discovery", "Book Follow-Up Call")}
      
      <p style="font-size:14px;color:#9ca3af;margin:24px 0 0 0;">
        Talk soon,<br>
        <strong style="color:#ffffff;">${agentName}</strong><br>
        Apex Financial
      </p>
    </div>
    
    <p style="font-size:12px;color:#6b7280;text-align:center;margin-top:32px;">
      © ${new Date().getFullYear()} Apex Financial. All rights reserved.
    </p>
  </div>
</body>
</html>
    `,
  },
  followup2_licensed: {
    subject: "Still thinking about the opportunity?",
    getHtml: (firstName: string, agentName: string) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background-color:#0a0a0a;color:#ffffff;word-break:break-word;">
  <div style="max-width:600px;margin:0 auto;padding:40px 20px;">
    <div style="text-align:center;margin-bottom:32px;">
      <h1 style="font-size:28px;font-weight:bold;margin:0;background:linear-gradient(135deg,#14b8a6,#0ea5e9);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">APEX FINANCIAL</h1>
    </div>
    
    <div style="background:linear-gradient(145deg,#1a1a2e,#16213e);border-radius:16px;padding:32px;border:1px solid rgba(20,184,166,0.2);">
      <h2 style="font-size:24px;margin:0 0 16px 0;color:#14b8a6;">Hey ${firstName}!</h2>
      
      <p style="font-size:16px;line-height:1.6;color:#d1d5db;margin:0 0 16px 0;">
        I wanted to circle back one more time. I know making a transition like this is a big decision, and I respect that you're taking time to think it through.
      </p>
      
      <p style="font-size:16px;line-height:1.6;color:#d1d5db;margin:0 0 16px 0;">
        That said, I genuinely believe what we're building at Apex is different. Our agents aren't just selling—they're building equity, real income, and a lifestyle that gives them freedom.
      </p>
      
      <p style="font-size:16px;line-height:1.6;color:#d1d5db;margin:0 0 24px 0;">
        <strong style="color:#ffffff;">If now isn't the right time, no worries.</strong> But if there's any part of you that's curious, let's revisit the conversation. Sometimes timing is everything.
      </p>
      
      ${ctaButton("https://calendly.com/apexlifeadvisors/15-minute-discovery", "Let's Reconnect")}
      
      <p style="font-size:14px;color:#9ca3af;margin:24px 0 0 0;">
        Here when you're ready,<br>
        <strong style="color:#ffffff;">${agentName}</strong><br>
        Apex Financial
      </p>
    </div>
    
    <p style="font-size:12px;color:#6b7280;text-align:center;margin-top:32px;">
      © ${new Date().getFullYear()} Apex Financial. All rights reserved.
    </p>
  </div>
</body>
</html>
    `,
  },
  followup1_unlicensed: {
    subject: "How's your licensing journey going? 📚",
    getHtml: (firstName: string, agentName: string) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background-color:#0a0a0a;color:#ffffff;word-break:break-word;">
  <div style="max-width:600px;margin:0 auto;padding:40px 20px;">
    <div style="text-align:center;margin-bottom:32px;">
      <h1 style="font-size:28px;font-weight:bold;margin:0;background:linear-gradient(135deg,#14b8a6,#0ea5e9);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">APEX FINANCIAL</h1>
    </div>
    
    <div style="background:linear-gradient(145deg,#1a1a2e,#16213e);border-radius:16px;padding:32px;border:1px solid rgba(20,184,166,0.2);">
      <h2 style="font-size:24px;margin:0 0 16px 0;color:#14b8a6;">Hey ${firstName}!</h2>
      
      <p style="font-size:16px;line-height:1.6;color:#d1d5db;margin:0 0 16px 0;">
        I wanted to check in and see how your licensing journey is going! Getting your life insurance license is the first big step toward a high-income career in financial services.
      </p>
      
      <p style="font-size:16px;line-height:1.6;color:#d1d5db;margin:0 0 16px 0;">
        Whether you've started studying, signed up for the course, or are still weighing your options—I'm here to help. A lot of our top earners started exactly where you are right now.
      </p>
      
      <p style="font-size:16px;line-height:1.6;color:#d1d5db;margin:0 0 24px 0;">
        <strong style="color:#ffffff;">Let me know where you're at</strong> and I can point you in the right direction. No pressure—just want to make sure you have the support you need.
      </p>
      
      ${ctaButton("https://calendly.com/sam-com593/licensed-prospect-call-clone", "Let's Chat About Your Progress")}
      
      <p style="font-size:14px;color:#9ca3af;margin:24px 0 0 0;">
        Rooting for you,<br>
        <strong style="color:#ffffff;">${agentName}</strong><br>
        Apex Financial
      </p>
    </div>
    
    <p style="font-size:12px;color:#6b7280;text-align:center;margin-top:32px;">
      © ${new Date().getFullYear()} Apex Financial. All rights reserved.
    </p>
  </div>
</body>
</html>
    `,
  },
  followup2_unlicensed: {
    subject: "Don't let this opportunity slip away 🤔",
    getHtml: (firstName: string, agentName: string) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background-color:#0a0a0a;color:#ffffff;word-break:break-word;">
  <div style="max-width:600px;margin:0 auto;padding:40px 20px;">
    <div style="text-align:center;margin-bottom:32px;">
      <h1 style="font-size:28px;font-weight:bold;margin:0;background:linear-gradient(135deg,#14b8a6,#0ea5e9);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">APEX FINANCIAL</h1>
    </div>
    
    <div style="background:linear-gradient(145deg,#1a1a2e,#16213e);border-radius:16px;padding:32px;border:1px solid rgba(20,184,166,0.2);">
      <h2 style="font-size:24px;margin:0 0 16px 0;color:#14b8a6;">Hey ${firstName}!</h2>
      
      <p style="font-size:16px;line-height:1.6;color:#d1d5db;margin:0 0 16px 0;">
        I'm reaching out one more time because I genuinely believe you have what it takes to succeed in this industry. The only thing standing between you and a $10k+ monthly income is getting licensed.
      </p>
      
      <p style="font-size:16px;line-height:1.6;color:#d1d5db;margin:0 0 16px 0;">
        I know it can feel overwhelming, but here's the truth: the license exam is easier than most people think, and we have resources to help you pass on your first try.
      </p>
      
      <p style="font-size:16px;line-height:1.6;color:#d1d5db;margin:0 0 24px 0;">
        <strong style="color:#ffffff;">If you're still interested, let's talk.</strong> I can walk you through exactly what you need to do to get started—step by step.
      </p>
      
      ${ctaButton("https://calendly.com/sam-com593/licensed-prospect-call-clone", "Get Licensed & Start Earning")}
      
      <p style="font-size:14px;color:#9ca3af;margin:24px 0 0 0;">
        Believe in you,<br>
        <strong style="color:#ffffff;">${agentName}</strong><br>
        Apex Financial
      </p>
    </div>
    
    <p style="font-size:12px;color:#6b7280;text-align:center;margin-top:32px;">
      © ${new Date().getFullYear()} Apex Financial. All rights reserved.
    </p>
  </div>
</body>
</html>
    `,
  },
  licensing_reminder: {
    subject: "Quick reminder: Your license is the key 🔑",
    getHtml: (firstName: string, agentName: string) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background-color:#0a0a0a;color:#ffffff;word-break:break-word;">
  <div style="max-width:600px;margin:0 auto;padding:40px 20px;">
    <div style="text-align:center;margin-bottom:32px;">
      <h1 style="font-size:28px;font-weight:bold;margin:0;background:linear-gradient(135deg,#14b8a6,#0ea5e9);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">APEX FINANCIAL</h1>
    </div>
    
    <div style="background:linear-gradient(145deg,#1a1a2e,#16213e);border-radius:16px;padding:32px;border:1px solid rgba(20,184,166,0.2);">
      <h2 style="font-size:24px;margin:0 0 16px 0;color:#14b8a6;">Hey ${firstName}!</h2>
      
      <p style="font-size:16px;line-height:1.6;color:#d1d5db;margin:0 0 16px 0;">
        Just a friendly reminder that your life insurance license is the key that unlocks everything at Apex Financial.
      </p>
      
      <div style="background:rgba(20,184,166,0.1);border-radius:8px;padding:20px;margin:20px 0;">
        <p style="font-size:16px;color:#14b8a6;margin:0 0 12px 0;font-weight:bold;">What's waiting for you:</p>
        <ul style="margin:0;padding-left:20px;color:#d1d5db;">
          <li style="margin-bottom:8px;">Unlimited warm leads provided daily</li>
          <li style="margin-bottom:8px;">Starting income of $10k+/month</li>
          <li style="margin-bottom:8px;">Full training and mentorship</li>
          <li style="margin-bottom:8px;">Equity partnership opportunity</li>
          <li>Work remotely or from the office</li>
        </ul>
      </div>
      
      <p style="font-size:16px;line-height:1.6;color:#d1d5db;margin:0 0 24px 0;">
        <strong style="color:#ffffff;">Need help getting started with your course?</strong> Let's hop on a quick call and I'll walk you through the fastest path to getting licensed.
      </p>
      
      ${ctaButton("https://calendly.com/sam-com593/licensed-prospect-call-clone", "Get Help With Licensing")}
      
      <p style="font-size:14px;color:#9ca3af;margin:24px 0 0 0;">
        Here to help,<br>
        <strong style="color:#ffffff;">${agentName}</strong><br>
        Apex Financial
      </p>
    </div>
    
    <p style="font-size:12px;color:#6b7280;text-align:center;margin-top:32px;">
      © ${new Date().getFullYear()} Apex Financial. All rights reserved.
    </p>
  </div>
</body>
</html>
    `,
  },
  licensing_checkin: {
    subject: "Checking in—need any help getting licensed? 🤝",
    getHtml: (firstName: string, agentName: string) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background-color:#0a0a0a;color:#ffffff;word-break:break-word;">
  <div style="max-width:600px;margin:0 auto;padding:40px 20px;">
    <div style="text-align:center;margin-bottom:32px;">
      <h1 style="font-size:28px;font-weight:bold;margin:0;background:linear-gradient(135deg,#14b8a6,#0ea5e9);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">APEX FINANCIAL</h1>
    </div>
    
    <div style="background:linear-gradient(145deg,#1a1a2e,#16213e);border-radius:16px;padding:32px;border:1px solid rgba(20,184,166,0.2);">
      <h2 style="font-size:24px;margin:0 0 16px 0;color:#14b8a6;">Hey ${firstName}!</h2>
      
      <p style="font-size:16px;line-height:1.6;color:#d1d5db;margin:0 0 16px 0;">
        I just wanted to check in and see how things are going. Getting licensed can feel like a big task, but I promise—it's totally doable, and I'm here to help however I can.
      </p>
      
      <p style="font-size:16px;line-height:1.6;color:#d1d5db;margin:0 0 16px 0;">
        A few things I can help with:
      </p>
      
      <div style="background:rgba(20,184,166,0.1);border-radius:8px;padding:20px;margin:20px 0;">
        <ul style="margin:0;padding-left:20px;color:#d1d5db;">
          <li style="margin-bottom:8px;">Choosing the right study course for your state</li>
          <li style="margin-bottom:8px;">Creating a study schedule that fits your life</li>
          <li style="margin-bottom:8px;">Understanding what's on the exam</li>
          <li style="margin-bottom:8px;">Tips from people who passed on their first try</li>
          <li>Answering any questions you have about the process</li>
        </ul>
      </div>
      
      <p style="font-size:16px;line-height:1.6;color:#d1d5db;margin:0 0 24px 0;">
        <strong style="color:#ffffff;">No judgment, no pressure.</strong> I just want to make sure you're not stuck and have everything you need to move forward.
      </p>
      
      ${ctaButton("https://calendly.com/sam-com593/licensed-prospect-call-clone", "Let's Chat—I'm Here to Help")}
      
      <p style="font-size:14px;color:#9ca3af;margin:24px 0 0 0;">
        In your corner,<br>
        <strong style="color:#ffffff;">${agentName}</strong><br>
        Apex Financial
      </p>
    </div>
    
    <p style="font-size:12px;color:#6b7280;text-align:center;margin-top:32px;">
      © ${new Date().getFullYear()} Apex Financial. All rights reserved.
    </p>
  </div>
</body>
</html>
    `,
  },
  course_help: {
    subject: "Need help with your licensing course? 📚",
    getHtml: (firstName: string, agentName: string) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background-color:#0a0a0a;color:#ffffff;word-break:break-word;">
  <div style="max-width:600px;margin:0 auto;padding:40px 20px;">
    <div style="text-align:center;margin-bottom:32px;">
      <h1 style="font-size:28px;font-weight:bold;margin:0;background:linear-gradient(135deg,#14b8a6,#0ea5e9);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">APEX FINANCIAL</h1>
    </div>
    
    <div style="background:linear-gradient(145deg,#1a1a2e,#16213e);border-radius:16px;padding:32px;border:1px solid rgba(20,184,166,0.2);">
      <h2 style="font-size:24px;margin:0 0 16px 0;color:#14b8a6;">Hey ${firstName}!</h2>
      
      <p style="font-size:16px;line-height:1.6;color:#d1d5db;margin:0 0 16px 0;">
        Congrats on purchasing your pre-licensing course! That's a big step toward building your career in financial services.
      </p>
      
      <p style="font-size:16px;line-height:1.6;color:#d1d5db;margin:0 0 16px 0;">
        I wanted to reach out and make sure you have everything you need to succeed. If you're feeling stuck, have questions about the material, or just want some study tips—I'm here to help!
      </p>
      
      <div style="background:rgba(20,184,166,0.1);border-radius:8px;padding:20px;margin:20px 0;">
        <p style="font-size:16px;color:#14b8a6;margin:0 0 12px 0;font-weight:bold;">Common questions I can help with:</p>
        <ul style="margin:0;padding-left:20px;color:#d1d5db;">
          <li style="margin-bottom:8px;">How to access your course materials</li>
          <li style="margin-bottom:8px;">Best study schedule for your situation</li>
          <li style="margin-bottom:8px;">Tips for passing on your first attempt</li>
          <li>What to do after you pass the exam</li>
        </ul>
      </div>
      
      <p style="font-size:16px;line-height:1.6;color:#d1d5db;margin:0 0 24px 0;">
        <strong style="color:#ffffff;">Let's hop on a quick call</strong> so I can answer your questions and make sure you're on the fastest path to getting licensed!
      </p>
      
      ${ctaButton("https://calendly.com/sam-com593/licensed-prospect-call-clone", "Get Course Help")}
      
      <p style="font-size:14px;color:#9ca3af;margin:24px 0 0 0;">
        Here to help you succeed,<br>
        <strong style="color:#ffffff;">${agentName}</strong><br>
        Apex Financial
      </p>
    </div>
    
    <p style="font-size:12px;color:#6b7280;text-align:center;margin-top:32px;">
      © ${new Date().getFullYear()} Apex Financial. All rights reserved.
    </p>
  </div>
</body>
</html>
    `,
  },
  schedule_consultation: {
    subject: "Let's schedule a quick consultation call 📞",
    getHtml: (firstName: string, agentName: string) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background-color:#0a0a0a;color:#ffffff;word-break:break-word;">
  <div style="max-width:600px;margin:0 auto;padding:40px 20px;">
    <div style="text-align:center;margin-bottom:32px;">
      <h1 style="font-size:28px;font-weight:bold;margin:0;background:linear-gradient(135deg,#14b8a6,#0ea5e9);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">APEX FINANCIAL</h1>
    </div>
    
    <div style="background:linear-gradient(145deg,#1a1a2e,#16213e);border-radius:16px;padding:32px;border:1px solid rgba(20,184,166,0.2);">
      <h2 style="font-size:24px;margin:0 0 16px 0;color:#14b8a6;">Hey ${firstName}!</h2>
      
      <p style="font-size:16px;line-height:1.6;color:#d1d5db;margin:0 0 16px 0;">
        I'd love to schedule a quick consultation call with you to discuss your career goals and answer any questions you have about joining Apex Financial.
      </p>
      
      <p style="font-size:16px;line-height:1.6;color:#d1d5db;margin:0 0 16px 0;">
        In our 15-minute call, I can walk you through:
      </p>
      
      <div style="background:rgba(20,184,166,0.1);border-radius:8px;padding:20px;margin:20px 0;">
        <ul style="margin:0;padding-left:20px;color:#d1d5db;">
          <li style="margin-bottom:8px;">How our training program works</li>
          <li style="margin-bottom:8px;">Realistic income expectations for new agents</li>
          <li style="margin-bottom:8px;">The licensing process (if you're not yet licensed)</li>
          <li style="margin-bottom:8px;">Next steps to get started</li>
          <li>Any other questions you have</li>
        </ul>
      </div>
      
      <p style="font-size:16px;line-height:1.6;color:#d1d5db;margin:0 0 24px 0;">
        <strong style="color:#ffffff;">No pressure, no sales pitch</strong>—just a real conversation to see if this is the right fit for you.
      </p>
      
      ${ctaButton("https://calendly.com/sam-com593/licensed-prospect-call-clone", "Schedule Your Consultation")}
      
      <p style="font-size:14px;color:#9ca3af;margin:24px 0 0 0;">
        Looking forward to connecting,<br>
        <strong style="color:#ffffff;">${agentName}</strong><br>
        Apex Financial
      </p>
    </div>
    
    <p style="font-size:12px;color:#6b7280;text-align:center;margin-top:32px;">
      © ${new Date().getFullYear()} Apex Financial. All rights reserved.
    </p>
  </div>
</body>
</html>
    `,
  },
  couldnt_reach_you: {
    subject: "We tried to call you! 📞",
    getHtml: (firstName: string, agentName: string) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background-color:#0a0a0a;color:#ffffff;word-break:break-word;">
  <div style="max-width:600px;margin:0 auto;padding:40px 20px;">
    <div style="text-align:center;margin-bottom:32px;">
      <h1 style="font-size:28px;font-weight:bold;margin:0;background:linear-gradient(135deg,#14b8a6,#0ea5e9);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">APEX FINANCIAL</h1>
    </div>
    
    <div style="background:linear-gradient(145deg,#1a1a2e,#16213e);border-radius:16px;padding:32px;border:1px solid rgba(20,184,166,0.2);">
      <h2 style="font-size:24px;margin:0 0 16px 0;color:#14b8a6;">Hey ${firstName}! 📞</h2>
      
      <p style="font-size:16px;line-height:1.6;color:#d1d5db;margin:0 0 16px 0;">
        We tried reaching out to you today about the opportunity at <strong style="color:#ffffff;">Apex Financial</strong>, but we couldn't get through to your number.
      </p>
      
      <p style="font-size:16px;line-height:1.6;color:#d1d5db;margin:0 0 16px 0;">
        No worries—we still want to connect! Here's what you can do:
      </p>
      
      <div style="background:rgba(20,184,166,0.1);border-radius:8px;padding:20px;margin:20px 0;">
        <ul style="margin:0;padding-left:20px;color:#d1d5db;">
          <li style="margin-bottom:12px;font-size:16px;">✓ <strong style="color:#ffffff;">Reply to this email</strong> with your best phone number</li>
          <li style="font-size:16px;">✓ <strong style="color:#ffffff;">Or schedule a time</strong> that works for you below</li>
        </ul>
      </div>
      
      <p style="font-size:16px;line-height:1.6;color:#d1d5db;margin:0 0 24px 0;">
        We're excited to chat with you about how you can start building a <strong style="color:#14b8a6;">high-income career</strong> in financial services.
      </p>
      
      ${ctaButton("https://calendly.com/apexlifeadvisors/15min", "Schedule a Call")}
      
      <p style="font-size:14px;color:#9ca3af;margin:24px 0 0 0;">
        Talk soon,<br>
        <strong style="color:#ffffff;">${agentName}</strong><br>
        Apex Financial
      </p>
    </div>
    
    <p style="font-size:12px;color:#6b7280;text-align:center;margin-top:32px;">
      © ${new Date().getFullYear()} Apex Financial. All rights reserved.
    </p>
  </div>
</body>
</html>
    `,
  },
};

type EmailTemplate = keyof typeof emailTemplates;

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
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { applicationId, agentId, templateType, customSubject, customBody, leadSource } = await req.json() as {
      applicationId: string;
      agentId: string;
      templateType: EmailTemplate;
      customSubject?: string;
      customBody?: string;
      leadSource?: "aged_leads" | "applications";
    };

    const missingFields = [];
    if (!applicationId) missingFields.push("applicationId");
    if (!templateType) missingFields.push("templateType");
    if (missingFields.length > 0) {
      console.error(`Missing fields: ${missingFields.join(", ")}. Received payload:`, JSON.stringify({ applicationId, agentId, templateType, leadSource }));
      return new Response(
        JSON.stringify({ success: false, error: `Missing required fields: ${missingFields.join(", ")}` }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Validate template type
    if (!emailTemplates[templateType]) {
      throw new Error(`Invalid template type: ${templateType}`);
    }

    // Determine which table to query based on leadSource
    const tableName = leadSource === "aged_leads" ? "aged_leads" : "applications";
    
    // Fetch lead from appropriate table
    const { data: lead, error: leadError } = await supabase
      .from(tableName)
      .select("*")
      .eq("id", applicationId)
      .single();

    if (leadError || !lead) {
      console.error(`Lead not found in ${tableName}:`, leadError);
      throw new Error(`Lead not found in ${tableName}`);
    }

    // Fetch agent name
    let agentName = "Apex Financial Team";
    if (agentId) {
      const { data: agent } = await supabase
        .from("agents")
        .select("user_id")
        .eq("id", agentId)
        .single();

      if (agent?.user_id) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("full_name")
          .eq("user_id", agent.user_id)
          .single();

        if (profile?.full_name) {
          agentName = profile.full_name;
        }
      }
    }

    const template = emailTemplates[templateType];
    const firstName = lead.first_name;
    
    // Use custom content if provided, otherwise use template defaults
    const subject = customSubject || template.subject;
    const html = customBody || template.getHtml(firstName, agentName);

    // Resolve manager email for CC
    let managerEmail: string | null = null;
    if (agentId) {
      managerEmail = await getManagerEmailFromAgent(supabase, agentId);
    } else if (leadSource === "aged_leads" && lead.assigned_manager_id) {
      managerEmail = await getManagerEmailFromAgent(supabase, lead.assigned_manager_id);
    } else if (lead.assigned_agent_id) {
      managerEmail = await getManagerEmailFromAgent(supabase, lead.assigned_agent_id);
    }
    const ccList = [ADMIN_EMAIL, managerEmail].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i) as string[];

    // Send email
    const { error: emailError } = await resend.emails.send({
      from: "APEX Financial <notifications@apex-financial.org>",
      to: [lead.email],
      cc: ccList.length > 0 ? ccList : undefined,
      subject,
      html,
    });

    if (emailError) {
      console.error("Error sending email:", emailError);
      throw new Error(`Failed to send email: ${emailError.message}`);
    }

    // Log to contact_history only for applications (aged_leads don't have contact_history)
    if (leadSource !== "aged_leads") {
      await supabase.from("contact_history").insert({
        application_id: applicationId,
        agent_id: agentId || null,
        contact_type: templateType.startsWith("cold") ? "cold_outreach" : "followup",
        email_template: templateType,
        subject: subject,
        notes: customBody ? `Sent customized ${templateType.replace(/_/g, " ")} email` : `Sent ${templateType.replace(/_/g, " ")} email`,
      });
    }

    // Update last_contacted_at timestamp
    await supabase
      .from(tableName)
      .update({ 
        last_contacted_at: new Date().toISOString(),
        contacted_at: lead.contacted_at || new Date().toISOString(),
      })
      .eq("id", applicationId);

    console.log(`Email sent successfully: ${templateType} to ${lead.email}`);

    return new Response(
      JSON.stringify({ success: true, template: templateType }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: any) {
    console.error("Error in send-outreach-email:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);
