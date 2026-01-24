import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background-color:#0a0a0a;color:#ffffff;">
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
      
      <div style="text-align:center;margin:32px 0;">
        <a href="https://calendly.com/apexlifeadvisors/15-minute-discovery" 
           style="display:inline-block;background:linear-gradient(135deg,#14b8a6,#0ea5e9);color:#ffffff;padding:16px 32px;text-decoration:none;border-radius:8px;font-weight:bold;font-size:16px;">
          Schedule a Call
        </a>
      </div>
      
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
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background-color:#0a0a0a;color:#ffffff;">
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
      
      <div style="text-align:center;margin:32px 0;">
        <a href="https://calendly.com/apexlifeadvisors/15min" 
           style="display:inline-block;background:linear-gradient(135deg,#14b8a6,#0ea5e9);color:#ffffff;padding:16px 32px;text-decoration:none;border-radius:8px;font-weight:bold;font-size:16px;">
          Let's Talk
        </a>
      </div>
      
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
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background-color:#0a0a0a;color:#ffffff;">
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
      
      <div style="text-align:center;margin:32px 0;">
        <a href="https://calendly.com/apexlifeadvisors/15-minute-discovery" 
           style="display:inline-block;background:linear-gradient(135deg,#14b8a6,#0ea5e9);color:#ffffff;padding:16px 32px;text-decoration:none;border-radius:8px;font-weight:bold;font-size:16px;">
          Book Follow-Up Call
        </a>
      </div>
      
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
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background-color:#0a0a0a;color:#ffffff;">
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
      
      <div style="text-align:center;margin:32px 0;">
        <a href="https://calendly.com/apexlifeadvisors/15-minute-discovery" 
           style="display:inline-block;background:linear-gradient(135deg,#14b8a6,#0ea5e9);color:#ffffff;padding:16px 32px;text-decoration:none;border-radius:8px;font-weight:bold;font-size:16px;">
          Let's Reconnect
        </a>
      </div>
      
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
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background-color:#0a0a0a;color:#ffffff;">
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
      
      <div style="text-align:center;margin:32px 0;">
        <a href="https://calendly.com/sam-com593/licensed-prospect-call-clone" 
           style="display:inline-block;background:linear-gradient(135deg,#14b8a6,#0ea5e9);color:#ffffff;padding:16px 32px;text-decoration:none;border-radius:8px;font-weight:bold;font-size:16px;">
          Let's Chat About Your Progress
        </a>
      </div>
      
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
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background-color:#0a0a0a;color:#ffffff;">
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
      
      <div style="text-align:center;margin:32px 0;">
        <a href="https://calendly.com/sam-com593/licensed-prospect-call-clone" 
           style="display:inline-block;background:linear-gradient(135deg,#14b8a6,#0ea5e9);color:#ffffff;padding:16px 32px;text-decoration:none;border-radius:8px;font-weight:bold;font-size:16px;">
          Get Licensed & Start Earning
        </a>
      </div>
      
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
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background-color:#0a0a0a;color:#ffffff;">
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
          <li style="margin-bottom:8px;">Free leads provided daily</li>
          <li style="margin-bottom:8px;">Starting income of $10k+/month</li>
          <li style="margin-bottom:8px;">Full training and mentorship</li>
          <li style="margin-bottom:8px;">Equity partnership opportunity</li>
          <li>Work remotely or from the office</li>
        </ul>
      </div>
      
      <p style="font-size:16px;line-height:1.6;color:#d1d5db;margin:0 0 24px 0;">
        <strong style="color:#ffffff;">Need help getting started with your course?</strong> Let's hop on a quick call and I'll walk you through the fastest path to getting licensed.
      </p>
      
      <div style="text-align:center;margin:32px 0;">
        <a href="https://calendly.com/sam-com593/licensed-prospect-call-clone" 
           style="display:inline-block;background:linear-gradient(135deg,#14b8a6,#0ea5e9);color:#ffffff;padding:16px 32px;text-decoration:none;border-radius:8px;font-weight:bold;font-size:16px;">
          Get Help With Licensing
        </a>
      </div>
      
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
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background-color:#0a0a0a;color:#ffffff;">
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
      
      <div style="text-align:center;margin:32px 0;">
        <a href="https://calendly.com/sam-com593/licensed-prospect-call-clone" 
           style="display:inline-block;background:linear-gradient(135deg,#14b8a6,#0ea5e9);color:#ffffff;padding:16px 32px;text-decoration:none;border-radius:8px;font-weight:bold;font-size:16px;">
          Let's Chat—I'm Here to Help
        </a>
      </div>
      
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

    const { applicationId, agentId, templateType, customSubject, customBody } = await req.json() as {
      applicationId: string;
      agentId: string;
      templateType: EmailTemplate;
      customSubject?: string;
      customBody?: string;
    };

    if (!applicationId || !templateType) {
      throw new Error("Missing required fields: applicationId and templateType");
    }

    // Validate template type
    if (!emailTemplates[templateType]) {
      throw new Error(`Invalid template type: ${templateType}`);
    }

    // Fetch application
    const { data: application, error: appError } = await supabase
      .from("applications")
      .select("*")
      .eq("id", applicationId)
      .single();

    if (appError || !application) {
      throw new Error("Application not found");
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
    const firstName = application.first_name;
    
    // Use custom content if provided, otherwise use template defaults
    const subject = customSubject || template.subject;
    const html = customBody || template.getHtml(firstName, agentName);

    // Send email
    const { error: emailError } = await resend.emails.send({
      from: "Apex Financial <team@updates.apexlifeadvisors.com>",
      to: [application.email],
      subject,
      html,
    });

    if (emailError) {
      console.error("Error sending email:", emailError);
      throw new Error(`Failed to send email: ${emailError.message}`);
    }

    // Log to contact_history
    await supabase.from("contact_history").insert({
      application_id: applicationId,
      agent_id: agentId || null,
      contact_type: templateType.startsWith("cold") ? "cold_outreach" : "followup",
      email_template: templateType,
      subject: subject,
      notes: customBody ? `Sent customized ${templateType.replace(/_/g, " ")} email` : `Sent ${templateType.replace(/_/g, " ")} email`,
    });

    console.log(`Email sent successfully: ${templateType} to ${application.email}`);

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
