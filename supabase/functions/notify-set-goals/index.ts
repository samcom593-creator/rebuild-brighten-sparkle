import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function sendEmail(to: string, subject: string, html: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: "APEX Financial <notifications@apex-financial.org>",
      to: [to],
      subject,
      html,
    }),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Resend error: ${error}`);
  }

  return res.json();
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get owner's phone number from request body (optional)
    const { ownerPhone = "your manager" } = await req.json().catch(() => ({}));

    // Get all active agents with profiles
    const { data: agents, error: agentsError } = await supabase
      .from("agents")
      .select(`
        id,
        user_id,
        profile_id,
        display_name
      `)
      .eq("is_deactivated", false)
      .eq("is_inactive", false)
      .eq("status", "active");

    if (agentsError) {
      console.error("Error fetching agents:", agentsError);
      throw agentsError;
    }

    if (!agents || agents.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: "No active agents found", sent: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get profiles for all agents
    const userIds = agents.map(a => a.user_id).filter(Boolean);
    const profileIds = agents.map(a => a.profile_id).filter(Boolean);

    const { data: profilesByUserId } = await supabase
      .from("profiles")
      .select("id, user_id, email, full_name")
      .or(`user_id.in.(${userIds.join(",")}),id.in.(${profileIds.join(",")})`);

    const profileByUserId = new Map(profilesByUserId?.filter(p => p.user_id).map(p => [p.user_id, p]) || []);
    const profileById = new Map(profilesByUserId?.map(p => [p.id, p]) || []);

    // Current month for email
    const currentMonth = new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" });

    let successCount = 0;
    let failCount = 0;
    const results: { email: string; status: string; error?: string }[] = [];

    for (const agent of agents) {
      // Try profile via profile_id first, then via user_id
      let profile = agent.profile_id ? profileById.get(agent.profile_id) : null;
      if (!profile && agent.user_id) {
        profile = profileByUserId.get(agent.user_id);
      }

      const email = profile?.email;
      const fullName = profile?.full_name || agent.display_name;

      if (!email) {
        results.push({ email: "unknown", status: "skipped", error: "No email found" });
        continue;
      }

      const firstName = fullName?.split(" ")[0] || "Agent";

      // Generate magic link for portal access
      const token = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

      await supabase.from("magic_login_tokens").insert({
        agent_id: agent.id,
        email,
        token,
        destination: "portal",
        expires_at: expiresAt.toISOString(),
      });

      const baseUrl = "https://rebuild-brighten-sparkle.lovable.app";
      const portalUrl = `${baseUrl}/magic-login?token=${token}`;

      try {
        const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background-color:#000;">
  <div style="max-width:600px;margin:0 auto;background:#111;border-radius:16px;overflow:hidden;margin-top:20px;margin-bottom:20px;">
    
    <!-- Header -->
    <div style="background:linear-gradient(135deg,#10b981 0%,#14b8a6 100%);padding:32px;text-align:center;">
      <h1 style="color:#fff;margin:0;font-size:28px;font-weight:800;">📊 Set Your ${currentMonth} Goals</h1>
    </div>
    
    <!-- Content -->
    <div style="padding:32px;">
      <p style="color:#fff;font-size:18px;margin:0 0 20px 0;">
        Hey ${firstName}! 👋
      </p>
      
      <p style="color:#a1a1aa;font-size:16px;line-height:1.6;margin:0 0 24px 0;">
        It's a new month and time to set your income goals! Take 30 seconds to log into your portal and set your target for ${currentMonth}.
      </p>
      
      <!-- CTA Button -->
      <div style="text-align:center;margin:32px 0;">
        <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 auto;">
          <tr>
            <td align="center" bgcolor="#10b981" style="border-radius:12px;">
              <a href="${portalUrl}" style="display:inline-block;color:#ffffff;font-size:18px;font-weight:700;text-decoration:none;padding:16px 40px;">
                Set My Goals →
              </a>
            </td>
          </tr>
        </table>
      </div>
      
      <!-- Instructions -->
      <div style="background:#1a1a1a;border-radius:12px;padding:20px;margin:24px 0;">
        <p style="color:#fff;font-size:14px;font-weight:600;margin:0 0 12px 0;">📝 Quick Steps:</p>
        <ol style="color:#a1a1aa;font-size:14px;line-height:1.8;margin:0;padding-left:20px;">
          <li>Click the button above to log into your portal</li>
          <li>Go to Settings → Income Goal</li>
          <li>Set your monthly income target</li>
          <li><strong style="color:#10b981;">Text your goal to ${ownerPhone}</strong></li>
        </ol>
      </div>
      
      <p style="color:#a1a1aa;font-size:14px;line-height:1.6;margin:24px 0 0 0;">
        Setting clear goals is the first step to crushing them. Let's make ${currentMonth} your best month yet! 🚀
      </p>
    </div>
    
    <!-- Footer -->
    <div style="padding:20px;text-align:center;border-top:1px solid #333;">
      <p style="color:#666;font-size:12px;margin:0;">
        Powered by Apex Financial
      </p>
    </div>
  </div>
</body>
</html>`;

        await sendEmail(email, `📊 ${currentMonth} Goals - Set Yours Now!`, emailHtml);
        results.push({ email, status: "sent" });
        successCount++;
      } catch (sendError) {
        console.error(`Error sending to ${email}:`, sendError);
        results.push({ email, status: "failed", error: String(sendError) });
        failCount++;
      }
    }

    console.log(`✅ Goal notification emails: ${successCount} sent, ${failCount} failed`);

    return new Response(
      JSON.stringify({
        success: true,
        sent: successCount,
        failed: failCount,
        total: agents.length,
        results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in notify-set-goals:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
