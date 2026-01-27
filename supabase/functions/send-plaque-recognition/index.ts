import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface PlaqueRequest {
  agentId: string;
  milestoneType: "single_day_bronze" | "single_day" | "weekly" | "monthly";
  amount: number;
  date: string;
}

const getMilestoneDetails = (type: string, amount: number) => {
  switch (type) {
    case "single_day_bronze":
      return {
        title: "Bronze Star Achievement",
        description: `Outstanding single-day production of $${amount.toLocaleString()}`,
        color: "#CD7F32", // Bronze
        emoji: "🥉",
        threshold: "$3,000+",
        badge: "BRONZE STAR",
      };
    case "single_day":
      return {
        title: "Gold Star Achievement", 
        description: `Exceptional single-day production of $${amount.toLocaleString()}`,
        color: "#FFD700", // Gold
        emoji: "🌟",
        threshold: "$5,000+",
        badge: "GOLD STAR",
      };
    case "weekly":
      return {
        title: "Diamond Week Achievement",
        description: `Incredible weekly production of $${amount.toLocaleString()}`,
        color: "#B9F2FF", // Diamond/Platinum
        emoji: "💎",
        threshold: "$10,000+",
        badge: "DIAMOND",
      };
    case "monthly":
      return {
        title: "Elite Producer Achievement",
        description: `Legendary monthly production of $${amount.toLocaleString()}`,
        color: "#1a1a1a", // Black & Gold
        emoji: "🏆",
        threshold: "$25,000+",
        badge: "ELITE PRODUCER",
      };
    default:
      return {
        title: "Achievement Unlocked",
        description: `Production milestone of $${amount.toLocaleString()}`,
        color: "#14b8a6",
        emoji: "⭐",
        threshold: "Milestone",
        badge: "ACHIEVER",
      };
  }
};

const generatePlaqueHTML = (
  agentName: string,
  milestone: ReturnType<typeof getMilestoneDetails>,
  date: string,
  amount: number
) => {
  const formattedDate = new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&family=Montserrat:wght@400;600;700&display=swap');
      </style>
    </head>
    <body style="margin:0;padding:40px;background:linear-gradient(135deg,#0a0a0a 0%,#1a1a2e 100%);font-family:'Montserrat',sans-serif;">
      <div style="max-width:650px;margin:0 auto;">
        <!-- Header Banner -->
        <div style="background:linear-gradient(135deg,${milestone.color}22 0%,${milestone.color}44 100%);border:2px solid ${milestone.color};border-radius:16px 16px 0 0;padding:30px;text-align:center;">
          <div style="font-size:72px;margin-bottom:10px;">${milestone.emoji}</div>
          <h1 style="font-family:'Playfair Display',serif;font-size:28px;color:${milestone.color};margin:0;letter-spacing:2px;">
            ${milestone.badge}
          </h1>
        </div>
        
        <!-- Main Certificate -->
        <div style="background:linear-gradient(180deg,#1a1a2e 0%,#0f0f1a 100%);border:2px solid ${milestone.color};border-top:none;border-radius:0 0 16px 16px;padding:40px;text-align:center;">
          <p style="color:#888;font-size:12px;text-transform:uppercase;letter-spacing:3px;margin:0 0 20px;">
            This is to certify that
          </p>
          
          <h2 style="font-family:'Playfair Display',serif;font-size:36px;color:#fff;margin:0 0 10px;text-shadow:0 0 30px ${milestone.color}44;">
            ${agentName}
          </h2>
          
          <p style="color:#14b8a6;font-size:14px;margin:0 0 30px;font-weight:600;">
            APEX Financial Group
          </p>
          
          <div style="background:${milestone.color}11;border:1px solid ${milestone.color}33;border-radius:12px;padding:25px;margin:0 0 30px;">
            <p style="color:#ccc;font-size:14px;margin:0 0 15px;">
              ${milestone.description}
            </p>
            <div style="font-size:42px;font-weight:700;color:${milestone.color};text-shadow:0 0 20px ${milestone.color}66;">
              $${amount.toLocaleString()}
            </div>
            <p style="color:#888;font-size:12px;margin:10px 0 0;">
              ${milestone.threshold} Milestone Achieved
            </p>
          </div>
          
          <div style="border-top:1px solid #333;padding-top:25px;display:flex;justify-content:space-between;align-items:center;">
            <div style="text-align:left;">
              <p style="color:#666;font-size:11px;margin:0;">Date Achieved</p>
              <p style="color:#fff;font-size:14px;margin:5px 0 0;font-weight:600;">${formattedDate}</p>
            </div>
            <div style="text-align:right;">
              <img src="https://id-preview--f583945a-f8ff-4a81-8442-9fc61f88a855.lovable.app/apex-icon.png" alt="APEX" style="height:40px;opacity:0.8;" />
            </div>
          </div>
        </div>
        
        <!-- Footer -->
        <div style="text-align:center;padding:25px;">
          <p style="color:#666;font-size:12px;margin:0;">
            🎉 Screenshot this certificate to share your achievement! 🎉
          </p>
        </div>
      </div>
    </body>
    </html>
  `;
};

const generateEmailHTML = (
  agentName: string,
  milestone: ReturnType<typeof getMilestoneDetails>,
  date: string,
  amount: number,
  isManager: boolean = false
) => {
  const formattedDate = new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long", 
    day: "numeric",
  });

  const recipientIntro = isManager 
    ? `Your team member <strong>${agentName}</strong> just hit an incredible milestone!`
    : `You just hit an incredible milestone!`;

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700&display=swap');
      </style>
    </head>
    <body style="margin:0;padding:0;background:#0a0a0a;font-family:'Montserrat',Arial,sans-serif;">
      <div style="max-width:600px;margin:0 auto;padding:40px 20px;">
        <!-- Celebration Header -->
        <div style="text-align:center;margin-bottom:30px;">
          <div style="font-size:80px;line-height:1;">${milestone.emoji}</div>
          <h1 style="color:${milestone.color};font-size:32px;margin:20px 0 10px;letter-spacing:1px;">
            ${milestone.badge}
          </h1>
          <p style="color:#888;font-size:14px;margin:0;">
            ${formattedDate}
          </p>
        </div>
        
        <!-- Main Content Card -->
        <div style="background:linear-gradient(135deg,#1a1a2e 0%,#0f0f1a 100%);border:2px solid ${milestone.color}44;border-radius:16px;padding:35px;margin-bottom:25px;">
          <p style="color:#ccc;font-size:16px;line-height:1.6;margin:0 0 25px;">
            ${recipientIntro}
          </p>
          
          <div style="background:${milestone.color}11;border-radius:12px;padding:25px;text-align:center;margin-bottom:25px;">
            <p style="color:#888;font-size:12px;text-transform:uppercase;letter-spacing:2px;margin:0 0 10px;">
              ${isManager ? agentName + "'s " : "Your "}Production
            </p>
            <div style="font-size:48px;font-weight:700;color:${milestone.color};">
              $${amount.toLocaleString()}
            </div>
            <p style="color:#14b8a6;font-size:14px;margin:10px 0 0;font-weight:600;">
              ${milestone.threshold} ${milestone.title.replace(' Achievement', '')}
            </p>
          </div>
          
          <p style="color:#aaa;font-size:14px;line-height:1.6;margin:0;">
            ${isManager 
              ? "This is a huge accomplishment that reflects their dedication and hard work. Make sure to congratulate them!"
              : "This is a huge accomplishment that reflects your dedication and skill. Keep pushing—you're building something great!"
            }
          </p>
        </div>
        
        <!-- Certificate Section -->
        <div style="background:#111;border:1px solid #333;border-radius:12px;padding:25px;text-align:center;margin-bottom:25px;">
          <h3 style="color:#fff;font-size:16px;margin:0 0 15px;">
            📜 Your Achievement Certificate
          </h3>
          <p style="color:#888;font-size:13px;margin:0 0 20px;">
            Below is your downloadable plaque. Screenshot it to share on social media!
          </p>
          <a href="https://apex-financial.org/agent-portal" 
             style="display:inline-block;background:linear-gradient(135deg,${milestone.color} 0%,${milestone.color}cc 100%);color:#000;font-weight:700;padding:14px 28px;border-radius:8px;text-decoration:none;font-size:14px;">
            View Your Plaque →
          </a>
        </div>
        
        <!-- Embedded Certificate Preview -->
        ${generatePlaqueHTML(agentName, milestone, date, amount)}
        
        <!-- Footer -->
        <div style="text-align:center;padding-top:20px;border-top:1px solid #222;">
          <p style="color:#666;font-size:12px;margin:0;">
            APEX Financial Group | Elite Performance Recognition
          </p>
        </div>
      </div>
    </body>
    </html>
  `;
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { agentId, milestoneType, amount, date }: PlaqueRequest = await req.json();
    
    console.log(`🏆 Processing plaque recognition for agent ${agentId}:`, { milestoneType, amount, date });

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch agent details - use maybeSingle to handle arrays properly
    const { data: agentData, error: agentError } = await supabase
      .from("agents")
      .select(`
        id,
        invited_by_manager_id,
        profile_id
      `)
      .eq("id", agentId)
      .single();

    if (agentError || !agentData) {
      console.error("Agent not found:", agentError);
      return new Response(JSON.stringify({ error: "Agent not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch profile separately
    let agentName = "Team Member";
    let agentEmail: string | null = null;
    
    if (agentData.profile_id) {
      const { data: profileData } = await supabase
        .from("profiles")
        .select("full_name, email")
        .eq("id", agentData.profile_id)
        .single();
      
      if (profileData) {
        agentName = profileData.full_name || "Team Member";
        agentEmail = profileData.email;
      }
    }

    const milestone = getMilestoneDetails(milestoneType, amount);

    console.log(`📧 Sending plaque email to ${agentName} (${agentEmail})`);

    // Send email to agent
    if (resendApiKey && agentEmail) {
      const resend = new Resend(resendApiKey);
      
      try {
        await resend.emails.send({
          from: "APEX Recognition <noreply@apex-financial.org>",
          to: [agentEmail],
          subject: `${milestone.emoji} ${milestone.badge} - Congratulations ${agentName}!`,
          html: generateEmailHTML(agentName, milestone, date, amount, false),
        });
        console.log(`✅ Plaque email sent to agent: ${agentEmail}`);
      } catch (emailError) {
        console.error("Failed to send agent email:", emailError);
      }

      // Send email to manager if exists
      if (agentData.invited_by_manager_id) {
        const { data: managerData } = await supabase
          .from("agents")
          .select("profile_id")
          .eq("id", agentData.invited_by_manager_id)
          .single();

        if (managerData?.profile_id) {
          const { data: managerProfile } = await supabase
            .from("profiles")
            .select("email")
            .eq("id", managerData.profile_id)
            .single();

          if (managerProfile?.email) {
            try {
              await resend.emails.send({
                from: "APEX Recognition <noreply@apex-financial.org>",
                to: [managerProfile.email],
                subject: `${milestone.emoji} Your Agent ${agentName} Earned: ${milestone.badge}!`,
                html: generateEmailHTML(agentName, milestone, date, amount, true),
              });
              console.log(`✅ Manager notification sent to: ${managerProfile.email}`);
            } catch (emailError) {
              console.error("Failed to send manager email:", emailError);
            }
          }
        }
      }
    } else {
      console.warn("⚠️ Resend API key not configured or agent has no email");
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `Plaque recognition sent for ${agentName}`,
        milestone: milestone.badge,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: unknown) {
    console.error("Error in send-plaque-recognition:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
