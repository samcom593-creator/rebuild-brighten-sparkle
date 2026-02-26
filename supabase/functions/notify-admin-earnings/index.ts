import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const ADMIN_AGENT_ID = "7c3c5581-3544-437f-bfe2-91391afb217d";
const ADMIN_EMAIL = "info@kingofsales.net";

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Get today's date in CST
    const now = new Date();
    const cstFormatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Chicago",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const todayCST = cstFormatter.format(now);

    // Get today's production for ALL agents
    const { data: production, error } = await supabase
      .from("daily_production")
      .select("agent_id, aop")
      .eq("production_date", todayCST);

    if (error) throw error;

    // Separate admin's AOP from everyone else's
    let adminAOP = 0;
    let othersAOP = 0;

    (production || []).forEach((row: any) => {
      const aop = Number(row.aop) || 0;
      if (row.agent_id === ADMIN_AGENT_ID) {
        adminAOP += aop;
      } else {
        othersAOP += aop;
      }
    });

    // Override earnings: others' AOP × 9/12 advance × 50% comp
    const overrideEarnings = othersAOP * (9 / 12) * 0.50;

    // Personal earnings: admin's AOP × 9/12 advance × 120% comp
    const personalEarnings = adminAOP * (9 / 12) * 1.20;

    // Total
    const totalEarnings = overrideEarnings + personalEarnings;

    // Format as currency
    const fmt = (n: number) =>
      new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(n);

    // Pretty date
    const dateDisplay = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago",
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(now);

    const formattedTotal = fmt(totalEarnings);

    await resend.emails.send({
      from: "APEX Financial Empire <notifications@tx.apex-financial.org>",
      to: [ADMIN_EMAIL],
      subject: `💰 Earnings Today — ${formattedTotal}`,
      html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;700;800&display=swap');
  </style>
</head>
<body style="font-family: 'Inter', 'Segoe UI', Tahoma, sans-serif; margin: 0; padding: 0; background-color: #050a14;">
  <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
    
    <!-- Main Card -->
    <div style="background: linear-gradient(160deg, #0a1628 0%, #0f1f3d 40%, #0d1a33 100%); border-radius: 24px; overflow: hidden; border: 1px solid rgba(56, 189, 248, 0.15); box-shadow: 0 0 80px rgba(56, 189, 248, 0.08), 0 0 40px rgba(6, 182, 212, 0.05);">
      
      <!-- Top accent bar -->
      <div style="height: 3px; background: linear-gradient(90deg, #0ea5e9, #06b6d4, #14b8a6, #06b6d4, #0ea5e9); background-size: 200% 100%;"></div>
      
      <!-- Inner padding -->
      <div style="padding: 48px 40px 40px;">
        
        <!-- Logo / Brand -->
        <div style="text-align: center; margin-bottom: 40px;">
          <div style="display: inline-block; background: linear-gradient(135deg, rgba(14, 165, 233, 0.15), rgba(6, 182, 212, 0.08)); border: 1px solid rgba(14, 165, 233, 0.2); border-radius: 12px; padding: 10px 24px;">
            <span style="color: #38bdf8; font-size: 11px; font-weight: 700; letter-spacing: 3px; text-transform: uppercase;">APEX FINANCIAL</span>
          </div>
        </div>

        <!-- Date -->
        <p style="color: #64748b; font-size: 13px; text-align: center; margin: 0 0 32px 0; font-weight: 400; letter-spacing: 0.5px;">
          ${dateDisplay}
        </p>
        
        <!-- Label -->
        <p style="color: #94a3b8; font-size: 14px; text-align: center; margin: 0 0 12px 0; font-weight: 600; letter-spacing: 2px; text-transform: uppercase;">
          Earnings Today
        </p>

        <!-- Big Number -->
        <div style="text-align: center; margin: 0 0 40px 0;">
          <span style="font-size: 56px; font-weight: 800; background: linear-gradient(135deg, #38bdf8 0%, #06b6d4 30%, #14b8a6 60%, #2dd4bf 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; letter-spacing: -2px; line-height: 1.1;">
            ${formattedTotal}
          </span>
        </div>
        
        <!-- Subtle divider -->
        <div style="height: 1px; background: linear-gradient(90deg, transparent, rgba(56, 189, 248, 0.2), transparent); margin: 0 0 32px 0;"></div>

        <!-- Stats row -->
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom: 24px;">
          <tr>
            <td width="50%" style="text-align: center; padding: 16px 8px; vertical-align: top;">
              <div style="background: rgba(14, 165, 233, 0.06); border: 1px solid rgba(14, 165, 233, 0.12); border-radius: 12px; padding: 20px 16px;">
                <p style="color: #64748b; font-size: 11px; font-weight: 600; letter-spacing: 1.5px; text-transform: uppercase; margin: 0 0 8px 0;">Team AOP</p>
                <p style="color: #e2e8f0; font-size: 22px; font-weight: 700; margin: 0; letter-spacing: -0.5px;">${fmt(othersAOP)}</p>
              </div>
            </td>
            <td width="50%" style="text-align: center; padding: 16px 8px; vertical-align: top;">
              <div style="background: rgba(20, 184, 166, 0.06); border: 1px solid rgba(20, 184, 166, 0.12); border-radius: 12px; padding: 20px 16px;">
                <p style="color: #64748b; font-size: 11px; font-weight: 600; letter-spacing: 1.5px; text-transform: uppercase; margin: 0 0 8px 0;">Personal AOP</p>
                <p style="color: #e2e8f0; font-size: 22px; font-weight: 700; margin: 0; letter-spacing: -0.5px;">${fmt(adminAOP)}</p>
              </div>
            </td>
          </tr>
        </table>

        <!-- Footer -->
        <div style="text-align: center; padding-top: 16px;">
          <p style="color: #334155; font-size: 11px; margin: 0; letter-spacing: 0.5px;">
            Powered by Apex Financial
          </p>
        </div>
        
      </div>
    </div>
    
  </div>
</body>
</html>
      `,
    });

    console.log(`Admin earnings email sent: ${formattedTotal} (override: ${fmt(overrideEarnings)}, personal: ${fmt(personalEarnings)})`);

    return new Response(
      JSON.stringify({
        success: true,
        totalEarnings: totalEarnings.toFixed(2),
        overrideEarnings: overrideEarnings.toFixed(2),
        personalEarnings: personalEarnings.toFixed(2),
        othersAOP,
        adminAOP,
        date: todayCST,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Error in notify-admin-earnings:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
};

serve(handler);
