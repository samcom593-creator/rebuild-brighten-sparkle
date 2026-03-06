import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function sendPush(userIds: string[], title: string, body: string, url: string) {
  try {
    const validIds = userIds.filter(Boolean);
    if (validIds.length === 0) return;
    await fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${serviceRoleKey}` },
      body: JSON.stringify({ userIds: validIds, title, body, url }),
    });
  } catch (e) {
    console.error("Push failed:", e);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { hirerName, hireeName, actionType } = await req.json();

    if (!hirerName || !hireeName) {
      return new Response(JSON.stringify({ error: "Missing hirerName or hireeName" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const resendKey = Deno.env.get("RESEND_API_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Fetch all managers
    const { data: managerRoles } = await supabase
      .from("user_roles")
      .select("user_id")
      .eq("role", "manager");

    if (!managerRoles?.length) {
      return new Response(JSON.stringify({ success: true, sent: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const managerUserIds = managerRoles.map((r) => r.user_id);

    const { data: profiles } = await supabase
      .from("profiles")
      .select("user_id, email, full_name")
      .in("user_id", managerUserIds);

    const managerEmails = profiles?.map((p) => p.email).filter(Boolean) || [];
    const adminEmail = "sam@apex-financial.org";

    // Send push to all managers
    await sendPush(
      managerUserIds,
      `🔥 New ${actionType === "contracted" ? "Contract" : "Hire"}!`,
      `${hirerName} just ${actionType === "contracted" ? "contracted" : "hired"} ${hireeName}!`,
      "/dashboard/applicants"
    );

    const verb = actionType === "contracted" ? "contracted" : "hired";
    const subject = `🔥 ${hirerName} just ${verb} ${hireeName}!`;

    const html = `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:Arial,sans-serif;">
  <div style="max-width:500px;margin:0 auto;padding:40px 20px;text-align:center;">
    <div style="background:linear-gradient(135deg,#1a1a2e,#16213e);border-radius:16px;padding:40px 30px;border:1px solid rgba(255,255,255,0.1);">
      <p style="font-size:28px;font-weight:bold;color:#ffffff;margin:0 0 8px;">${hirerName} just ${verb}</p>
      <p style="font-size:32px;font-weight:bold;color:#00d4aa;margin:0;">${hireeName}! 🎉</p>
    </div>
    <p style="color:#666;font-size:11px;margin-top:20px;">Powered by Apex Financial</p>
  </div>
</body>
</html>`;

    const allRecipients = [...new Set([...managerEmails, adminEmail])];

    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "APEX Financial <notifications@tx.apex-financial.org>",
        to: allRecipients,
        subject,
        html,
      }),
    });

    const emailData = await emailRes.json();
    console.log("Hire announcement sent:", emailData);

    return new Response(
      JSON.stringify({ success: true, sent: allRecipients.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in notify-hire-announcement:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
