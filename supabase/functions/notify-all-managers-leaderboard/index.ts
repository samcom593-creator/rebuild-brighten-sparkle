import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

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
  const { data: roleData, error: roleError } = await supabaseAdmin
    .from("user_roles")
    .select("user_id, role")
    .in("role", ["manager", "admin"]);

  if (roleError || !roleData?.length) return [];

  const managersMap = new Map<string, { email: string; name: string; userId: string }>();

  for (const role of roleData) {
    const { data: authData } = await supabaseAdmin.auth.admin.getUserById(role.user_id);
    if (!authData?.user?.email || managersMap.has(authData.user.email)) continue;

    const { data: profileData } = await supabaseAdmin
      .from("profiles")
      .select("full_name")
      .eq("user_id", role.user_id)
      .single();

    managersMap.set(authData.user.email, {
      email: authData.user.email,
      name: profileData?.full_name || authData.user.email,
      userId: role.user_id,
    });
  }

  return Array.from(managersMap.values());
}

async function getScoringManagerName(managerId: string | undefined, referralSource: string | undefined): Promise<string> {
  if (managerId) {
    const { data: agentData } = await supabaseAdmin.from("agents").select("user_id").eq("id", managerId).single();
    if (agentData?.user_id) {
      const { data: profileData } = await supabaseAdmin.from("profiles").select("full_name").eq("user_id", agentData.user_id).single();
      if (profileData?.full_name) return profileData.full_name;
    }
  }

  if (referralSource?.trim()) {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (uuidRegex.test(referralSource)) {
      const { data: agentData } = await supabaseAdmin.from("agents").select("user_id").eq("id", referralSource).single();
      if (agentData?.user_id) {
        const { data: profileData } = await supabaseAdmin.from("profiles").select("full_name").eq("user_id", agentData.user_id).single();
        if (profileData?.full_name) return profileData.full_name;
      }
    }
  }

  return "Organic Lead";
}

async function getApplicationDetails(applicationId: string) {
  const { data } = await supabaseAdmin
    .from("applications")
    .select("first_name, last_name, email, phone, city, state, license_status, notes")
    .eq("id", applicationId)
    .single();
  return data;
}

function buildLeaderboardEmail(
  scoringManagerName: string,
  applicantName: string,
  appDetails: { phone?: string; city?: string; state?: string; license_status?: string; notes?: string } | null,
  applicationId: string
): { subject: string; html: string } {
  const isOrganic = scoringManagerName === "Organic Lead";
  const safeName = sanitizeHtml(applicantName);
  const safeManager = sanitizeHtml(scoringManagerName);
  const appUrl = `https://rebuild-brighten-sparkle.lovable.app/dashboard/applicants?lead=${applicationId}`;

  const subject = isOrganic
    ? `🔥 New Organic Lead: ${safeName}!`
    : `🏆 ${safeManager} Just Recruited ${safeName}!`;

  const headline = isOrganic
    ? `New organic lead: ${safeName}`
    : `${safeManager} just got a new recruit: ${safeName}!`;

  const phone = appDetails?.phone || "N/A";
  const location = [appDetails?.city, appDetails?.state].filter(Boolean).join(", ") || "N/A";
  const license = appDetails?.license_status === "licensed" ? "Licensed ✅" : "Unlicensed";
  const motivation = appDetails?.notes ? sanitizeHtml(appDetails.notes.slice(0, 200)) : "";

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background-color:#f5f5f5;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f5f5;padding:40px 20px;">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:500px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.1);">

<!-- Header -->
<tr><td style="background:linear-gradient(135deg,#D4AF37,#C5A028);padding:30px;text-align:center;">
<h1 style="margin:0;color:#000;font-size:22px;font-weight:bold;">${headline}</h1>
</td></tr>

<!-- Applicant Details -->
<tr><td style="padding:30px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
<tr><td style="padding:8px 0;color:#666;font-size:14px;">📱 Phone</td>
<td style="padding:8px 0;color:#333;font-size:14px;font-weight:600;text-align:right;">${sanitizeHtml(phone)}</td></tr>
<tr><td style="padding:8px 0;color:#666;font-size:14px;border-top:1px solid #eee;">📍 Location</td>
<td style="padding:8px 0;color:#333;font-size:14px;font-weight:600;text-align:right;border-top:1px solid #eee;">${sanitizeHtml(location)}</td></tr>
<tr><td style="padding:8px 0;color:#666;font-size:14px;border-top:1px solid #eee;">📋 License</td>
<td style="padding:8px 0;color:#333;font-size:14px;font-weight:600;text-align:right;border-top:1px solid #eee;">${license}</td></tr>
</table>

${motivation ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8f9fa;border-radius:8px;margin-bottom:20px;">
<tr><td style="padding:16px;">
<p style="margin:0 0 4px;color:#666;font-size:12px;font-weight:600;">NOTES</p>
<p style="margin:0;color:#333;font-size:14px;line-height:1.5;">${motivation}</p>
</td></tr></table>` : ""}

<p style="margin:0 0 20px;color:#333;font-size:16px;text-align:center;">
That's an estimated <strong>$7,000</strong> in potential override value! 💰
</p>

<!-- Action Buttons -->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr>
<td width="48%" style="padding-right:4px;">
<a href="${appUrl}" style="display:block;background:#D4AF37;color:#000;font-size:14px;font-weight:700;text-decoration:none;padding:14px 0;border-radius:8px;text-align:center;max-width:100%;box-sizing:border-box;">
View Lead →
</a>
</td>
<td width="48%" style="padding-left:4px;">
<a href="tel:${phone.replace(/\D/g, "")}" style="display:block;background:#22c55e;color:#fff;font-size:14px;font-weight:700;text-decoration:none;padding:14px 0;border-radius:8px;text-align:center;max-width:100%;box-sizing:border-box;">
📞 Call Now
</a>
</td>
</tr>
</table>
</td></tr>

<!-- Footer -->
<tr><td style="background-color:#1a1a1a;padding:20px;text-align:center;">
<p style="margin:0;color:#888;font-size:12px;">Apex Financial Enterprises</p>
</td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;

  return { subject, html };
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: LeaderboardRequest = await req.json();
    console.log("[Leaderboard] Processing for application:", body.applicationId);

    const [managers, scorerName, appDetails] = await Promise.all([
      getAllManagerEmails(),
      getScoringManagerName(body.scoringManagerId, body.referralSource),
      getApplicationDetails(body.applicationId),
    ]);

    if (managers.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: "No managers to notify", sent: 0 }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    console.log(`[Leaderboard] Scorer: ${scorerName}, sending to ${managers.length} managers`);

    let sentCount = 0;
    const { subject, html } = buildLeaderboardEmail(
      scorerName,
      body.applicantName || "New Recruit",
      appDetails,
      body.applicationId
    );

    for (const manager of managers) {
      if (!RESEND_API_KEY) break;

      try {
        const response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: "APEX Financial <noreply@apex-financial.org>",
            to: [manager.email],
            subject,
            html,
          }),
        });

        if (response.ok) {
          sentCount++;
          console.log(`[Leaderboard] ✅ Sent to ${manager.email}`);
        } else {
          console.error(`[Leaderboard] Failed: ${manager.email}`, await response.text());
        }
      } catch (error) {
        console.error(`[Leaderboard] Error: ${manager.email}`, error);
      }

      await new Promise(resolve => setTimeout(resolve, 500));
    }

    return new Response(
      JSON.stringify({ success: true, sent: sentCount, total: managers.length, scorer: scorerName }),
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
