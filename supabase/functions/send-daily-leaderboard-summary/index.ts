import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ManagerRanking {
  rank: number;
  agentId: string;
  userId: string;
  name: string;
  email: string;
  totalRecruits: number;
  licensedRecruits: number;
  closedRecruits: number;
}

function sanitizeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function getManagerLeaderboard(): Promise<ManagerRanking[]> {
  console.log("[DailyLeaderboard] Fetching manager leaderboard data...");

  // Get all managers
  const { data: roleData, error: roleError } = await supabaseAdmin
    .from("user_roles")
    .select("user_id")
    .eq("role", "manager");

  if (roleError) {
    console.error("[DailyLeaderboard] Error fetching manager roles:", roleError);
    return [];
  }

  const managerUserIds = roleData?.map(r => r.user_id) || [];
  console.log(`[DailyLeaderboard] Found ${managerUserIds.length} managers`);

  if (managerUserIds.length === 0) return [];

  // Get agent IDs for these managers
  const { data: agentsData, error: agentsError } = await supabaseAdmin
    .from("agents")
    .select("id, user_id")
    .in("user_id", managerUserIds);

  if (agentsError) {
    console.error("[DailyLeaderboard] Error fetching agents:", agentsError);
    return [];
  }

  const rankings: ManagerRanking[] = [];

  for (const agent of agentsData || []) {
    // Get manager's email from auth
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.getUserById(agent.user_id);
    
    if (authError || !authData?.user?.email) {
      console.warn(`[DailyLeaderboard] Could not get email for user ${agent.user_id}`);
      continue;
    }

    // Get manager's name from profiles
    const { data: profileData } = await supabaseAdmin
      .from("profiles")
      .select("full_name")
      .eq("user_id", agent.user_id)
      .single();

    // Count applications referred by this manager (referral_source stores the manager's agent ID)
    const { data: apps, error: appsError } = await supabaseAdmin
      .from("applications")
      .select("id, license_status, status")
      .eq("referral_source", agent.id);

    if (appsError) {
      console.warn(`[DailyLeaderboard] Error fetching apps for agent ${agent.id}:`, appsError);
      continue;
    }

    const totalRecruits = apps?.length || 0;
    const licensedRecruits = apps?.filter(a => a.license_status === "licensed").length || 0;
    const closedRecruits = apps?.filter(a => a.status === "closed").length || 0;

    rankings.push({
      rank: 0,
      agentId: agent.id,
      userId: agent.user_id,
      name: profileData?.full_name || authData.user.email,
      email: authData.user.email,
      totalRecruits,
      licensedRecruits,
      closedRecruits,
    });
  }

  // Sort by total recruits and assign ranks
  rankings.sort((a, b) => b.totalRecruits - a.totalRecruits);
  rankings.forEach((r, idx) => {
    r.rank = idx + 1;
  });

  console.log(`[DailyLeaderboard] Compiled rankings for ${rankings.length} managers`);
  return rankings;
}

function getRankIcon(rank: number): string {
  if (rank === 1) return "🥇";
  if (rank === 2) return "🥈";
  if (rank === 3) return "🥉";
  return `#${rank}`;
}

function buildLeaderboardEmail(rankings: ManagerRanking[], recipientRank: number, recipientName: string): string {
  const today = new Date().toLocaleDateString("en-US", { 
    weekday: "long", 
    year: "numeric", 
    month: "long", 
    day: "numeric" 
  });

  const rowsHtml = rankings.map(r => {
    const isRecipient = r.rank === recipientRank;
    const rankDisplay = getRankIcon(r.rank);
    const bgColor = isRecipient ? "#FFF8E1" : (r.rank % 2 === 0 ? "#f9f9f9" : "#ffffff");
    const fontWeight = isRecipient ? "bold" : "normal";
    const indicator = isRecipient ? "⭐ " : "";
    
    return `
      <tr style="background-color: ${bgColor};">
        <td style="padding: 12px 16px; font-weight: ${fontWeight}; font-size: 16px;">${rankDisplay}</td>
        <td style="padding: 12px 16px; font-weight: ${fontWeight};">${indicator}${sanitizeHtml(r.name)}${isRecipient ? " (You)" : ""}</td>
        <td style="padding: 12px 16px; text-align: center; font-weight: ${fontWeight};">${r.totalRecruits}</td>
        <td style="padding: 12px 16px; text-align: center; color: #2E7D32;">${r.licensedRecruits}</td>
        <td style="padding: 12px 16px; text-align: center; color: #1565C0;">${r.closedRecruits}</td>
      </tr>
    `;
  }).join("");

  // Calculate distance to next rank
  let motivationText = "";
  if (recipientRank > 1) {
    const nextUp = rankings.find(r => r.rank === recipientRank - 1);
    const current = rankings.find(r => r.rank === recipientRank);
    if (nextUp && current) {
      const gap = nextUp.totalRecruits - current.totalRecruits;
      if (gap > 0) {
        motivationText = `<p style="color: #D4AF37; font-size: 16px; margin-top: 20px;">💡 You're just <strong>${gap} recruit${gap > 1 ? 's' : ''}</strong> away from #${recipientRank - 1}!</p>`;
      } else {
        motivationText = `<p style="color: #D4AF37; font-size: 16px; margin-top: 20px;">💡 You're tied with #${recipientRank - 1} - one more recruit and you take the lead!</p>`;
      }
    }
  } else {
    motivationText = `<p style="color: #D4AF37; font-size: 16px; margin-top: 20px;">👑 You're #1 - keep dominating!</p>`;
  }

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f5f5f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 650px; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
          
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #D4AF37, #C5A028); padding: 30px; text-align: center;">
              <h1 style="margin: 0; color: #000000; font-size: 28px; font-weight: bold;">
                🏆 APEX Daily Leaderboard
              </h1>
              <p style="margin: 10px 0 0 0; color: #1a1a1a; font-size: 16px;">
                ${today}
              </p>
            </td>
          </tr>
          
          <!-- Greeting -->
          <tr>
            <td style="padding: 30px 30px 20px 30px;">
              <p style="margin: 0; color: #333333; font-size: 18px;">
                Hey ${sanitizeHtml(recipientName.split(" ")[0])}, here's where you stand today:
              </p>
            </td>
          </tr>
          
          <!-- Leaderboard Table -->
          <tr>
            <td style="padding: 0 20px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse: collapse; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden;">
                <thead>
                  <tr style="background-color: #1a1a1a; color: #ffffff;">
                    <th style="padding: 14px 16px; text-align: left; font-weight: 600;">Rank</th>
                    <th style="padding: 14px 16px; text-align: left; font-weight: 600;">Manager</th>
                    <th style="padding: 14px 16px; text-align: center; font-weight: 600;">Total</th>
                    <th style="padding: 14px 16px; text-align: center; font-weight: 600;">Licensed</th>
                    <th style="padding: 14px 16px; text-align: center; font-weight: 600;">Closed</th>
                  </tr>
                </thead>
                <tbody>
                  ${rowsHtml}
                </tbody>
              </table>
            </td>
          </tr>
          
          <!-- Motivation -->
          <tr>
            <td style="padding: 20px 30px 30px 30px; text-align: center;">
              ${motivationText}
              <p style="margin: 20px 0 0 0; color: #666666; font-size: 14px;">
                Keep scaling up your team. Let's go! 🚀
              </p>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="background-color: #1a1a1a; padding: 20px; text-align: center;">
              <p style="margin: 0; color: #888888; font-size: 12px;">
                Apex Financial Enterprises
              </p>
            </td>
          </tr>
          
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

async function sendLeaderboardEmail(
  recipient: ManagerRanking,
  rankings: ManagerRanking[]
): Promise<boolean> {
  if (!RESEND_API_KEY) {
    console.log("[DailyLeaderboard] Resend not configured, skipping email to:", recipient.email);
    return false;
  }

  const subject = `🏆 Daily Leaderboard - You're #${recipient.rank}`;
  const emailHtml = buildLeaderboardEmail(rankings, recipient.rank, recipient.name);

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "APEX Financial <noreply@apex-financial.org>",
        to: [recipient.email],
        subject: subject,
        html: emailHtml,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[DailyLeaderboard] Failed to send to ${recipient.email}:`, errorText);
      return false;
    }

    console.log(`[DailyLeaderboard] ✅ Email sent to ${recipient.email} (Rank #${recipient.rank})`);
    return true;
  } catch (error) {
    console.error(`[DailyLeaderboard] Error sending to ${recipient.email}:`, error);
    return false;
  }
}

const handler = async (req: Request): Promise<Response> => {
  console.log("[DailyLeaderboard] Request received:", req.method);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Get full leaderboard
    const rankings = await getManagerLeaderboard();

    if (rankings.length === 0) {
      console.log("[DailyLeaderboard] No managers found");
      return new Response(
        JSON.stringify({ success: true, message: "No managers to notify", sent: 0 }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    console.log(`[DailyLeaderboard] Sending daily summary to ${rankings.length} managers...`);

    // Send personalized email to each manager
    let sentCount = 0;
    for (const manager of rankings) {
      const sent = await sendLeaderboardEmail(manager, rankings);
      if (sent) sentCount++;
      
      // Rate limiting delay
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    console.log(`[DailyLeaderboard] ✅ Completed: ${sentCount}/${rankings.length} emails sent`);

    return new Response(
      JSON.stringify({
        success: true,
        message: `Daily leaderboard sent to ${sentCount} managers`,
        sent: sentCount,
        total: rankings.length,
        topRanked: rankings[0]?.name || "N/A",
      }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );

  } catch (error: any) {
    console.error("[DailyLeaderboard] Error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);
