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
  // Priority 1: Check scoringManagerId (direct manager assignment)
  if (managerId) {
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
        console.log(`[Leaderboard] Found manager name from ID: ${profileData.full_name}`);
        return profileData.full_name;
      }
    }
  }

  // Priority 2: Check if referral_source is a manager UUID
  if (referralSource && referralSource.trim()) {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    
    if (uuidRegex.test(referralSource)) {
      // It's a UUID - look up the manager's name
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
          console.log(`[Leaderboard] Found manager name from referral UUID: ${profileData.full_name}`);
          return profileData.full_name;
        }
      }
    }
    
    // IMPORTANT: Do NOT use generic referral sources like "Agent Referral", "Social Media", etc.
    // These are NOT manager names - they are category labels from the application form.
    // Only actual manager names should appear in leaderboard emails.
    // If referral_source is not a UUID, it's either:
    // - A generic category label (ignore these)
    // - A typed "Word of mouth" name (these are NOT managers, so still organic)
    
    console.log(`[Leaderboard] referralSource "${referralSource}" is not a manager UUID - treating as organic`);
  }

  // Default: No manager identified = Organic Lead
  return "Organic Lead";
}

async function sendLeaderboardEmail(
  recipientEmail: string,
  recipientName: string,
  scoringManagerName: string,
  applicantName: string
): Promise<boolean> {
  if (!RESEND_API_KEY) {
    console.log("[Leaderboard] Resend not configured, skipping email to:", recipientEmail);
    return false;
  }

  const isOrganic = scoringManagerName === "Organic Lead";
  const safeName = sanitizeHtml(applicantName);
  const safeManager = sanitizeHtml(scoringManagerName);
  
  const subject = isOrganic 
    ? `🔥 New Organic Lead: ${safeName}!` 
    : `🏆 ${safeManager} Just Recruited ${safeName}!`;

  const headline = isOrganic
    ? `New organic lead: ${safeName}`
    : `${safeManager} just got a new recruit: ${safeName}!`;

  const growthLine = `That's an estimated <strong>$7,000</strong> in potential override value! 💰`;

  const emailHtml = `
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
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 500px; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
          
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #D4AF37, #C5A028); padding: 30px; text-align: center;">
              <h1 style="margin: 0; color: #000000; font-size: 24px; font-weight: bold;">
                ${headline}
              </h1>
            </td>
          </tr>
          
          <!-- Body -->
          <tr>
            <td style="padding: 40px 30px; text-align: center;">
              <p style="margin: 0 0 20px; color: #333333; font-size: 18px; line-height: 1.6;">
                ${growthLine}
              </p>
              <p style="margin: 0; color: #333333; font-size: 18px; line-height: 1.6;">
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

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "APEX Financial <noreply@apex-financial.org>",
        to: [recipientEmail],
        subject: subject,
        html: emailHtml,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Leaderboard] Failed to send to ${recipientEmail}:`, errorText);
      return false;
    }

    console.log(`[Leaderboard] ✅ Email sent to ${recipientEmail}`);
    return true;
  } catch (error) {
    console.error(`[Leaderboard] Error sending to ${recipientEmail}:`, error);
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

    // Send to all managers with rate limiting
    let sentCount = 0;
    for (const manager of managers) {
      const sent = await sendLeaderboardEmail(
        manager.email,
        manager.name,
        scorerName,
        body.applicantName || "New Recruit"
      );
      if (sent) sentCount++;
      
      // Add delay between emails to prevent rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
    }

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
