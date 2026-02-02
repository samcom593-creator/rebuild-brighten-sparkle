import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

interface PerformanceRequest {
  agentId: string;
  amount: number;
  weekEndingDate: string;
  milestoneType?: string;
  ownerName?: string;
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function formatAmount(amount: number): string {
  return Math.round(amount).toLocaleString("en-US");
}

function generateCertificateHTML(
  agentName: string,
  amount: number,
  weekEndingDate: string,
  ownerName: string = "Standard of Excellence"
): string {
  const formattedDate = formatDate(weekEndingDate);
  const formattedAmount = formatAmount(amount);

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#f5f5f5;font-family:Georgia,'Times New Roman',serif;">
  <div style="width:100%;max-width:700px;margin:20px auto;background:#ffffff;box-shadow:0 4px 20px rgba(0,0,0,0.1);">
    
    <!-- Gold accent top border -->
    <div style="height:6px;background:linear-gradient(90deg,#C9A962,#E8D5A3,#C9A962);"></div>
    
    <div style="padding:40px 25px;text-align:center;">
      
      <!-- Main Header - Mobile Optimized -->
      <h1 style="font-family:Georgia,serif;font-size:28px;font-weight:bold;color:#1a1a1a;margin:0 0 4px 0;letter-spacing:2px;text-transform:uppercase;word-break:break-word;">
        OUTSTANDING
      </h1>
      <h1 style="font-family:Georgia,serif;font-size:28px;font-weight:bold;color:#1a1a1a;margin:0 0 30px 0;letter-spacing:2px;text-transform:uppercase;word-break:break-word;">
        PERFORMANCE
      </h1>
      
      <!-- Decorative line -->
      <div style="width:100px;height:2px;background:#C9A962;margin:0 auto 30px;"></div>
      
      <!-- Company Name -->
      <p style="font-size:16px;font-weight:600;color:#333333;margin:0 0 8px 0;letter-spacing:1px;">
        APEX Financial Group
      </p>
      <p style="font-size:13px;color:#666666;margin:0 0 25px 0;font-style:italic;">
        hereby expresses its appreciation to
      </p>
      
      <!-- Agent Name - Mobile Optimized -->
      <h2 style="font-family:Georgia,serif;font-size:26px;font-weight:bold;color:#1a1a1a;margin:0 0 25px 0;border-bottom:2px solid #C9A962;display:inline-block;padding-bottom:8px;word-break:break-word;">
        ${agentName}
      </h2>
      
      <!-- Achievement Description -->
      <p style="font-size:13px;color:#666666;margin:0 0 10px 0;">
        for outstanding achievement for the week ending
      </p>
      <p style="font-size:18px;font-weight:bold;color:#1a1a1a;margin:0 0 15px 0;">
        ${formattedDate}
      </p>
      
      <!-- Amount Box - Mobile Optimized -->
      <div style="background:linear-gradient(135deg,#f8f6f0,#ffffff);border:2px solid #C9A962;border-radius:8px;padding:15px 20px;margin:0 auto 25px;display:inline-block;max-width:90%;box-sizing:border-box;">
        <p style="font-size:18px;font-weight:bold;color:#1a1a1a;margin:0;letter-spacing:0.5px;word-break:break-word;">
          FOR WRITING $${formattedAmount} IN ALP
        </p>
      </div>
      
      <!-- Appreciation -->
      <p style="font-size:14px;font-style:italic;color:#555555;margin:0 0 35px 0;">
        Your efforts are greatly appreciated.
      </p>
      
      <!-- Signature Section -->
      <div style="margin-top:25px;">
        <p style="font-family:'Brush Script MT','Lucida Handwriting',cursive;font-size:26px;color:#333333;margin:0 0 5px 0;">
          ${ownerName}
        </p>
        <div style="width:180px;height:1px;background:#333333;margin:0 auto 10px;"></div>
        <p style="font-size:11px;color:#666666;margin:0;line-height:1.5;">
          ${ownerName}<br>
          Chief Executive Officer<br>
          APEX Financial Group
        </p>
      </div>
      
    </div>
    
    <!-- Footer -->
    <div style="background:#1a1a1a;padding:12px;text-align:center;">
      <p style="font-size:10px;color:#888888;margin:0;">
        Powered by APEX Financial
      </p>
    </div>
    
  </div>
</body>
</html>
`;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const {
      agentId,
      amount,
      weekEndingDate,
      milestoneType = "weekly",
      ownerName = "King of Sales",
    }: PerformanceRequest = await req.json();

    console.log(`📜 Generating Outstanding Performance certificate for agent ${agentId}`);
    console.log(`💰 Amount: $${amount}, Week Ending: ${weekEndingDate}`);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get agent details
    const { data: agent, error: agentError } = await supabase
      .from("agents")
      .select("user_id, display_name")
      .eq("id", agentId)
      .single();

    if (agentError || !agent?.user_id) {
      console.error("Agent not found:", agentError);
      return new Response(
        JSON.stringify({ success: false, error: "Agent not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get profile details
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("full_name, email")
      .eq("user_id", agent.user_id)
      .single();

    if (profileError || !profile?.email) {
      console.error("Profile not found:", profileError);
      return new Response(
        JSON.stringify({ success: false, error: "Profile not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const agentName = agent.display_name || profile.full_name || "Agent";
    const formattedAmount = formatAmount(amount);

    // Generate certificate HTML
    const certificateHTML = generateCertificateHTML(
      agentName,
      amount,
      weekEndingDate,
      ownerName
    );

    const results: { admin?: unknown; agent?: unknown; errors: string[] } = { errors: [] };

    // Send to Admin
    try {
      console.log("📧 Sending certificate to admin...");
      const adminResult = await resend.emails.send({
        from: "APEX Financial <noreply@apex-financial.org>",
        to: ["info@kingofsales.net"],
        subject: `Weekly Performance: ${agentName} - $${formattedAmount} ALP`,
        html: certificateHTML,
      });
      results.admin = adminResult;
      console.log("✅ Admin email sent successfully");
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      console.error("Failed to send admin email:", err);
      results.errors.push(`Admin email failed: ${errorMessage}`);
    }

    // Send to Agent
    try {
      console.log(`📧 Sending certificate to agent: ${profile.email}`);
      const agentResult = await resend.emails.send({
        from: "APEX Financial <noreply@apex-financial.org>",
        to: [profile.email],
        subject: `Outstanding Performance Recognition - ${formatDate(weekEndingDate)}`,
        html: certificateHTML,
      });
      results.agent = agentResult;
      console.log("✅ Agent email sent successfully");
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      console.error("Failed to send agent email:", err);
      results.errors.push(`Agent email failed: ${errorMessage}`);
    }

    return new Response(
      JSON.stringify({
        success: results.errors.length === 0,
        agentName,
        amount,
        weekEndingDate,
        milestoneType,
        results,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: unknown) {
    console.error("Error in send-outstanding-performance:", error);
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
