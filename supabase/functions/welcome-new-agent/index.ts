import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface WelcomeEmailRequest {
  agentName: string;
  agentEmail: string;
}

const handler = async (req: Request): Promise<Response> => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { agentName, agentEmail }: WelcomeEmailRequest = await req.json();

    console.log(`Sending welcome email to ${agentName} at ${agentEmail}`);

    const discordLink = "https://discord.gg/GygkGEhb";

    const emailHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #3b82f6 0%, #06b6d4 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; }
          .highlight { background: #dbeafe; padding: 15px; border-radius: 8px; margin: 20px 0; }
          .button { display: inline-block; background: #3b82f6; color: white !important; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; margin: 10px 0; }
          .footer { text-align: center; margin-top: 20px; color: #6b7280; font-size: 14px; }
          ul { padding-left: 20px; margin: 10px 0; }
          li { margin: 5px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Welcome to Apex Financial!</h1>
            <p>Bill for One Percent</p>
          </div>
          <div class="content">
            <p>Hello ${agentName},</p>
            
            <p>Welcome to the Apex Financial team! We're excited to have you on board and can't wait to see you succeed.</p>
            
            <div class="highlight">
              <h3>📅 Daily Agency Meeting</h3>
              <p><strong>Time:</strong> Every day at <strong>10:00 AM CST</strong></p>
              <p>Please have your camera on and ready to go!</p>
            </div>
            
            <div class="highlight">
              <h3>⏰ Daily Numbers Deadline</h3>
              <p>Please submit your daily production numbers <strong>by 8:00 PM CST</strong> each day.</p>
              <p>This keeps our leaderboards accurate and ensures you don't miss out on recognition!</p>
            </div>
            
            <div class="highlight">
              <h3>🚨 Team Deal Alerts</h3>
              <p>When any teammate closes a deal, you'll receive an instant <strong>DEAL ALERT</strong> email to keep you motivated and in the loop!</p>
            </div>
            
            <div class="highlight">
              <h3>🏆 Competition Updates You'll Receive</h3>
              <ul>
                <li>🌅 <strong>Morning Top Performers</strong> - Daily at 9 AM CST</li>
                <li>🔥 <strong>Hot Streak Alerts</strong> - When you're on a winning streak</li>
                <li>📊 <strong>Weekly Champion Announcements</strong> - Every Sunday</li>
                <li>📈 <strong>Rank Change Notifications</strong> - When someone passes you</li>
              </ul>
            </div>
            
            <div class="highlight">
              <h3>💬 Join Our Discord Community</h3>
              <p>Connect with your team, get support, and stay updated:</p>
              <a href="${discordLink}" class="button">Join Discord</a>
            </div>
            
            <div class="highlight">
              <h3>📊 Log Your Daily Numbers</h3>
              <p>Track your production and compete on the leaderboard:</p>
              <a href="https://apex-financial.org/agent-portal" class="button">Access Agent Portal</a>
            </div>
            
            <p>If you have any questions, don't hesitate to reach out to your manager.</p>
            
            <p>Let's build something great together!</p>
            
            <p>Best regards,<br>The Apex Financial Team</p>
          </div>
          <div class="footer">
            <p>© ${new Date().getFullYear()} Apex Financial. All rights reserved.</p>
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
        from: "APEX Financial <notifications@tx.apex-financial.org>",
        to: [agentEmail],
        subject: "Welcome to Apex Financial! 🎉",
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
