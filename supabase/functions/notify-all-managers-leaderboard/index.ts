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

interface LeaderboardRequest {
  applicationId: string;
  scoringManagerId?: string;
  applicantName: string;
  applicantCity?: string;
  applicantState?: string;
  licenseStatus: string;
  referralSource?: string;
}

function sanitizeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function getAllManagerEmails(): Promise<Array<{ email: string; name: string; userId: string }>> {
  console.log("[Leaderboard] Fetching all managers and admins...");
  
  // Get all users with manager or admin role
  const { data: roleData, error: roleError } = await supabaseAdmin
    .from("user_roles")
    .select("user_id, role")
    .in("role", ["manager", "admin"]);

  if (roleError) {
    console.error("[Leaderboard] Error fetching roles:", roleError);
    return [];
  }

  console.log(`[Leaderboard] Found ${roleData?.length || 0} managers/admins`);

  const managersMap = new Map<string, { email: string; name: string; userId: string }>();

  for (const role of roleData || []) {
    // Get email from auth.users (most reliable)
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.getUserById(role.user_id);
    
    if (authError || !authData?.user?.email) {
      console.warn(`[Leaderboard] Could not get auth email for user ${role.user_id}`);
      continue;
    }

    // Skip if we already have this email (prevents duplicates for dual-role users)
    if (managersMap.has(authData.user.email)) {
      continue;
    }

    // Get name from profiles
    const { data: profileData } = await supabaseAdmin
      .from("profiles")
      .select("full_name")
      .eq("user_id", role.user_id)
      .single();

    managersMap.set(authData.user.email, {
      email: authData.user.email,
      name: profileData?.full_name || authData.user.email,
      userId: role.user_id
    });
  }

  const managers = Array.from(managersMap.values());
  console.log(`[Leaderboard] Resolved ${managers.length} unique manager emails:`, managers.map(m => m.email));
  return managers;
}

async function getScoringManagerName(managerId: string | undefined, referralSource: string | undefined): Promise<string> {
  if (managerId) {
    // Get manager's name from agent -> profile
    const { data: agentData } = await supabaseAdmin
      .from("agents")
      .select("user_id")
      .eq("id", managerId)
      .single();

    if (agentData?.user_id) {
      const { data: profileData } = await supabaseAdmin
        .from("profiles")
        .select("full_name")
        .eq("user_id", agentData.user_id)
        .single();

      if (profileData?.full_name) {
        return profileData.full_name;
      }
    }
  }

  // Check referral_source for a name
  if (referralSource && referralSource.trim()) {
    // If it's a UUID, try to look it up
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (uuidRegex.test(referralSource)) {
      const { data: agentData } = await supabaseAdmin
        .from("agents")
        .select("user_id")
        .eq("id", referralSource)
        .single();

      if (agentData?.user_id) {
        const { data: profileData } = await supabaseAdmin
          .from("profiles")
          .select("full_name")
          .eq("user_id", agentData.user_id)
          .single();

        if (profileData?.full_name) {
          return profileData.full_name;
        }
      }
    }
    
    // Otherwise use the referral source as-is (might be a typed name)
    return referralSource;
  }

  return "Organic Lead";
}

async function sendLeaderboardEmail(
  recipientEmail: string,
  recipientName: string,
  scorerName: string,
  applicantName: string,
  applicantLocation: string,
  licenseStatus: string,
  isOrganic: boolean
): Promise<boolean> {
  if (!RESEND_API_KEY) {
    console.log("[Leaderboard] Resend not configured, skipping email to:", recipientEmail);
    return false;
  }

  const isLicensed = licenseStatus === "licensed";
  const badgeColor = isLicensed ? "#22c55e" : "#f59e0b";
  const badgeText = isLicensed ? "LICENSED" : "UNLICENSED";
  
  const subjectLine = isOrganic 
    ? `🎯 New Organic Lead - ${applicantName}!`
    : `🏆 ${scorerName} Scored Another Recruit!`;

  const headerText = isOrganic
    ? `New organic lead just applied!`
    : `${sanitizeHtml(scorerName)} just landed a new recruit!`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f8fafc;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    
    <!-- Trophy Header -->
    <div style="background: linear-gradient(135deg, #1e3a5f 0%, #2d5a87 100%); border-radius: 16px 16px 0 0; padding: 30px; text-align: center;">
      <div style="font-size: 48px; margin-bottom: 10px;">${isOrganic ? '🎯' : '🏆'}</div>
      <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 700;">
        ${headerText}
      </h1>
    </div>

    <!-- Main Content -->
    <div style="background-color: #ffffff; padding: 30px; border-radius: 0 0 16px 16px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
      
      <!-- Applicant Card -->
      <div style="background-color: #f1f5f9; border-radius: 12px; padding: 20px; margin-bottom: 20px;">
        <div style="display: flex; align-items: center; margin-bottom: 15px;">
          <div style="background-color: #1e3a5f; color: white; width: 50px; height: 50px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 20px; font-weight: bold; margin-right: 15px;">
            ${applicantName.charAt(0).toUpperCase()}
          </div>
          <div>
            <h2 style="margin: 0; color: #1e293b; font-size: 18px;">${sanitizeHtml(applicantName)}</h2>
            <p style="margin: 5px 0 0 0; color: #64748b; font-size: 14px;">📍 ${sanitizeHtml(applicantLocation || 'Location not specified')}</p>
          </div>
        </div>
        
        <!-- License Badge -->
        <div style="display: inline-block; background-color: ${badgeColor}; color: white; padding: 6px 12px; border-radius: 20px; font-size: 12px; font-weight: 600;">
          ${badgeText}
        </div>
      </div>

      ${!isOrganic ? `
      <!-- Scorer Highlight -->
      <div style="background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); border-radius: 12px; padding: 20px; text-align: center; margin-bottom: 20px;">
        <p style="margin: 0; color: #92400e; font-size: 14px;">Referred by</p>
        <p style="margin: 5px 0 0 0; color: #78350f; font-size: 20px; font-weight: 700;">⭐ ${sanitizeHtml(scorerName)}</p>
      </div>
      ` : `
      <!-- Organic Lead Call to Action -->
      <div style="background: linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%); border-radius: 12px; padding: 20px; text-align: center; margin-bottom: 20px;">
        <p style="margin: 0; color: #1e40af; font-size: 16px; font-weight: 600;">🔥 This is an organic lead!</p>
        <p style="margin: 10px 0 0 0; color: #1e40af; font-size: 14px;">First to reach out gets the credit!</p>
      </div>
      `}

      <!-- Motivational Footer -->
      <div style="text-align: center; padding-top: 20px; border-top: 1px solid #e2e8f0;">
        <p style="color: #64748b; font-size: 14px; margin: 0;">
          Keep recruiting and grow your team! 💪
        </p>
      </div>
    </div>

    <!-- Footer -->
    <div style="text-align: center; padding: 20px; color: #94a3b8; font-size: 12px;">
      <p style="margin: 0;">Apex Financial Enterprises</p>
      <p style="margin: 5px 0 0 0;">You're receiving this because you're part of the management team.</p>
    </div>
  </div>
</body>
</html>
  `;

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: "Apex Financial <notifications@apex-financial.org>",
        to: [recipientEmail],
        subject: subjectLine,
        html: html,
      }),
    });

    const result = await response.json();
    
    if (response.ok) {
      console.log(`[Leaderboard] ✅ Email sent to ${recipientEmail}:`, result.id);
      return true;
    } else {
      console.error(`[Leaderboard] ❌ Failed to send to ${recipientEmail}:`, result);
      return false;
    }
  } catch (error) {
    console.error(`[Leaderboard] ❌ Error sending to ${recipientEmail}:`, error);
    return false;
  }
}

const handler = async (req: Request): Promise<Response> => {
  console.log("[Leaderboard] Request received:", req.method);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: LeaderboardRequest = await req.json();
    console.log("[Leaderboard] Processing request for application:", body.applicationId);

    // Get all managers
    const managers = await getAllManagerEmails();
    
    if (managers.length === 0) {
      console.log("[Leaderboard] No managers found to notify");
      return new Response(
        JSON.stringify({ success: true, message: "No managers to notify", sent: 0 }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Determine who scored this recruit
    const scorerName = await getScoringManagerName(body.scoringManagerId, body.referralSource);
    const isOrganic = scorerName === "Organic Lead";
    
    console.log(`[Leaderboard] Scorer: ${scorerName} (organic: ${isOrganic})`);

    // Build location string
    const location = [body.applicantCity, body.applicantState].filter(Boolean).join(", ") || "Unknown";

    // Send to all managers
    let sentCount = 0;
    const sendPromises = managers.map(async (manager) => {
      const success = await sendLeaderboardEmail(
        manager.email,
        manager.name,
        scorerName,
        body.applicantName,
        location,
        body.licenseStatus,
        isOrganic
      );
      if (success) sentCount++;
      return success;
    });

    await Promise.all(sendPromises);

    console.log(`[Leaderboard] ✅ Completed: ${sentCount}/${managers.length} emails sent`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `Leaderboard notifications sent to ${sentCount} managers`,
        sent: sentCount,
        total: managers.length,
        scorer: scorerName
      }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );

  } catch (error: any) {
    console.error("[Leaderboard] Error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);
