import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface PlaqueRequest {
  agentId: string;
  milestoneType: 
    | "single_day_bronze" 
    | "single_day" 
    | "single_day_platinum"
    | "weekly" 
    | "monthly"
    | "recruiter_rising"
    | "hiring_champion"
    | "team_builder"
    | "hot_streak"
    | "on_fire"
    | "unstoppable"
    | "comeback_champion";
  amount: number;
  date: string;
}

const getMilestoneDetails = (type: string, amount: number) => {
  // CRITICAL: Round to whole dollars - NO CENTS
  const roundedAmount = Math.round(amount);
  
  switch (type) {
    case "single_day_bronze":
      return {
        title: "Bronze Achievement",
        description: `Outstanding single-day production of $${roundedAmount.toLocaleString()}`,
        color: "#CD7F32",
        threshold: "$1,000+",
        badge: "BRONZE ACHIEVEMENT",
        amount: roundedAmount,
      };
    case "single_day":
      return {
        title: "Gold Achievement", 
        description: `Exceptional single-day production of $${roundedAmount.toLocaleString()}`,
        color: "#C9A962",
        threshold: "$3,000+",
        badge: "GOLD ACHIEVEMENT",
        amount: roundedAmount,
      };
    case "single_day_platinum":
      return {
        title: "Platinum Achievement",
        description: `Elite single-day production of $${roundedAmount.toLocaleString()}`,
        color: "#E5E4E2",
        threshold: "$5,000+",
        badge: "PLATINUM ACHIEVEMENT",
        amount: roundedAmount,
      };
    case "weekly":
      return {
        title: "Weekly Diamond",
        description: `Exceptional weekly production of $${roundedAmount.toLocaleString()}`,
        color: "#7DD3FC",
        threshold: "$10,000+",
        badge: "WEEKLY DIAMOND",
        amount: roundedAmount,
      };
    case "monthly":
      return {
        title: "Elite Producer",
        description: `Outstanding monthly production of $${roundedAmount.toLocaleString()}`,
        color: "#A78BFA",
        threshold: "$25,000+",
        badge: "ELITE PRODUCER",
        amount: roundedAmount,
      };
    case "recruiter_rising":
      return {
        title: "Recruiter Rising",
        description: `Contracted ${roundedAmount} agents in a single day`,
        color: "#22C55E",
        threshold: "3+ Hired",
        badge: "RECRUITER RISING",
        amount: roundedAmount,
      };
    case "hiring_champion":
      return {
        title: "Hiring Champion",
        description: `Exceptional recruiting: ${roundedAmount} agents contracted in one day`,
        color: "#FBBF24",
        threshold: "5+ Hired",
        badge: "HIRING CHAMPION",
        amount: roundedAmount,
      };
    case "team_builder":
      return {
        title: "Team Builder",
        description: `Built a powerhouse: ${roundedAmount} agents contracted this week`,
        color: "#F97316",
        threshold: "10+ Weekly",
        badge: "TEAM BUILDER",
        amount: roundedAmount,
      };
    case "hot_streak":
      return {
        title: "Hot Streak",
        description: `${roundedAmount} consecutive days closing deals`,
        color: "#EF4444",
        threshold: "5+ Days",
        badge: "HOT STREAK",
        amount: roundedAmount,
      };
    case "on_fire":
      return {
        title: "On Fire",
        description: `${roundedAmount} consecutive days dominating the leaderboard`,
        color: "#F97316",
        threshold: "10+ Days",
        badge: "ON FIRE",
        amount: roundedAmount,
      };
    case "unstoppable":
      return {
        title: "Unstoppable",
        description: `Legendary ${roundedAmount}-day deal streak`,
        color: "#DC2626",
        threshold: "20+ Days",
        badge: "UNSTOPPABLE",
        amount: roundedAmount,
      };
    case "comeback_champion":
      return {
        title: "Comeback Champion",
        description: `Massive week-over-week improvement: +$${roundedAmount.toLocaleString()}`,
        color: "#8B5CF6",
        threshold: "$3,000+ Improvement",
        badge: "COMEBACK CHAMPION",
        amount: roundedAmount,
      };
    default:
      return {
        title: "Achievement",
        description: `Production milestone of $${roundedAmount.toLocaleString()}`,
        color: "#14b8a6",
        threshold: "Milestone",
        badge: "ACHIEVEMENT",
        amount: roundedAmount,
      };
  }
};

const generatePlaqueHTML = (
  agentName: string,
  milestone: ReturnType<typeof getMilestoneDetails>,
  date: string,
  instagram?: string | null
) => {
  const formattedDate = new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const instagramSection = instagram ? `
    <p style="font-family:'Inter',sans-serif;font-size:11px;font-weight:400;color:#666;margin:16px 0 0;letter-spacing:0.5px;">
      @${instagram}
    </p>
  ` : '';

  // PREMIUM MINIMALIST DESIGN - Clean, screenshot-worthy, professional
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600&family=Inter:wght@300;400;500&display=swap');
      </style>
    </head>
    <body style="margin:0;padding:40px;background:#0a0a0a;font-family:'Inter',sans-serif;">
      <div style="max-width:540px;margin:0 auto;">
        <!-- Plaque Container - Clean Border -->
        <div style="background:#0f0f0f;border:1px solid ${milestone.color}40;border-radius:2px;padding:56px 48px;text-align:center;">
          
          <!-- Top Accent Line -->
          <div style="width:48px;height:2px;background:${milestone.color};margin:0 auto 36px;opacity:0.8;"></div>
          
          <!-- Badge Label -->
          <p style="font-family:'Inter',sans-serif;font-size:10px;font-weight:500;letter-spacing:4px;color:${milestone.color};margin:0 0 28px;text-transform:uppercase;">
            ${milestone.badge}
          </p>
          
          <!-- Recipient Name -->
          <h1 style="font-family:'Playfair Display',Georgia,serif;font-size:28px;font-weight:500;color:#ffffff;margin:0 0 6px;letter-spacing:0.5px;">
            ${agentName}
          </h1>
          
          <!-- Instagram Handle -->
          ${instagramSection}
          
          <!-- Company -->
          <p style="font-family:'Inter',sans-serif;font-size:10px;font-weight:400;color:#555;margin:20px 0 44px;letter-spacing:2px;text-transform:uppercase;">
            Apex Financial Group
          </p>
          
          <!-- Amount - Clean & Bold -->
          <div style="margin:0 0 44px;">
            <p style="font-family:'Playfair Display',Georgia,serif;font-size:48px;font-weight:600;color:${milestone.color};margin:0;letter-spacing:-1px;">
              $${milestone.amount.toLocaleString()}
            </p>
          </div>
          
          <!-- Achievement Description -->
          <p style="font-family:'Inter',sans-serif;font-size:12px;font-weight:400;color:#777;margin:0 0 8px;line-height:1.5;">
            ${milestone.description}
          </p>
          
          <p style="font-family:'Inter',sans-serif;font-size:10px;font-weight:400;color:#444;margin:0;">
            ${formattedDate}
          </p>
          
          <!-- Bottom Accent Line -->
          <div style="width:48px;height:2px;background:#222;margin:36px auto 0;"></div>
          
        </div>
        
        <!-- Powered By Footer -->
        <div style="text-align:center;margin-top:20px;">
          <p style="font-family:'Inter',sans-serif;font-size:9px;font-weight:400;color:#333;margin:0;letter-spacing:1px;text-transform:uppercase;">
            Powered by Apex Financial
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
  isManager: boolean = false,
  instagram?: string | null
) => {
  const formattedDate = new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long", 
    day: "numeric",
  });

  const recipientIntro = isManager 
    ? `Your team member <strong>${agentName}</strong> has achieved an exceptional milestone.`
    : `You have achieved an exceptional milestone.`;

  // INSTITUTIONAL EMAIL DESIGN - Clean, professional, no emojis in body
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&display=swap');
      </style>
    </head>
    <body style="margin:0;padding:0;background:#0a0a0a;font-family:'Inter',Arial,sans-serif;">
      <div style="max-width:560px;margin:0 auto;padding:48px 24px;">
        
        <!-- Header -->
        <div style="text-align:center;margin-bottom:40px;">
          <p style="font-size:11px;font-weight:500;letter-spacing:3px;color:#666;margin:0 0 8px;text-transform:uppercase;">
            ${milestone.badge}
          </p>
          <p style="font-size:12px;color:#888;margin:0;">
            ${formattedDate}
          </p>
        </div>
        
        <!-- Main Content -->
        <div style="background:#141414;border:1px solid #222;border-radius:4px;padding:40px;margin-bottom:32px;">
          <p style="color:#ccc;font-size:15px;line-height:1.7;margin:0 0 32px;">
            ${recipientIntro}
          </p>
          
          <!-- Amount Card -->
          <div style="background:#0a0a0a;border:1px solid #2a2a2a;border-radius:2px;padding:32px;text-align:center;margin-bottom:32px;">
            <p style="font-size:11px;font-weight:500;letter-spacing:2px;color:#666;margin:0 0 12px;text-transform:uppercase;">
              ${isManager ? agentName + "'s " : "Your "}Production
            </p>
            <p style="font-size:40px;font-weight:600;color:${milestone.color};margin:0;">
              $${milestone.amount.toLocaleString()}
            </p>
            <p style="font-size:12px;color:#888;margin:12px 0 0;">
              ${milestone.threshold} ${milestone.title}
            </p>
          </div>
          
          <p style="color:#888;font-size:14px;line-height:1.7;margin:0;">
            ${isManager 
              ? "This achievement reflects their dedication and skill. Ensure they receive appropriate recognition."
              : "This achievement reflects your dedication and skill. Continue building on this momentum."
            }
          </p>
        </div>
        
        <!-- Plaque Preview -->
        <div style="margin-bottom:32px;">
          ${generatePlaqueHTML(agentName, milestone, date)}
        </div>
        
        <!-- CTA Button -->
        <div style="text-align:center;margin-bottom:40px;">
          <a href="https://rebuild-brighten-sparkle.lovable.app/agent-portal" 
             style="display:inline-block;background:${milestone.color};color:#000;font-weight:600;padding:14px 32px;border-radius:2px;text-decoration:none;font-size:13px;letter-spacing:0.5px;">
            View Portal
          </a>
        </div>
        
        <!-- Footer -->
        <div style="text-align:center;border-top:1px solid #222;padding-top:24px;">
          <p style="font-size:11px;color:#555;margin:0;letter-spacing:1px;">
            APEX FINANCIAL GROUP
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

    // Fetch instagram handle
    let instagramHandle: string | null = null;
    const { data: fullProfile } = await supabase
      .from("profiles")
      .select("instagram_handle")
      .eq("id", agentData.profile_id)
      .single();
    instagramHandle = fullProfile?.instagram_handle || null;

    const milestone = getMilestoneDetails(milestoneType, amount);

    console.log(`📧 Sending plaque email to ${agentName} (${agentEmail})`);

    // Send email to agent
    if (resendApiKey && agentEmail) {
      const resend = new Resend(resendApiKey);
      
      try {
        await resend.emails.send({
          from: "APEX Financial <notifications@tx.apex-financial.org>",
          to: [agentEmail],
          subject: `${milestone.badge} - Congratulations ${agentName}`,
          html: generateEmailHTML(agentName, milestone, date, false),
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
                from: "APEX Financial <notifications@tx.apex-financial.org>",
                to: [managerProfile.email],
                subject: `Team Achievement: ${agentName} - ${milestone.badge}`,
                html: generateEmailHTML(agentName, milestone, date, true),
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
