import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const resendKey = Deno.env.get("RESEND_API_KEY");
    const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const resend = resendKey ? new Resend(resendKey) : null;

    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();

    // Find dropped applicants: old, no activity, not contracted, no winback sent recently
    const { data: dropped, error } = await supabase
      .from("applications")
      .select("id, first_name, last_name, email, phone, created_at, winback_sent_at, license_status")
      .lt("created_at", thirtyDaysAgo)
      .is("contracted_at", null)
      .is("terminated_at", null)
      .neq("license_status", "licensed")
      .order("created_at", { ascending: true });

    if (error) throw error;

    const results: string[] = [];
    const now = new Date();

    for (const app of dropped || []) {
      // Skip if winback sent in last 30 days
      if (app.winback_sent_at && (now.getTime() - new Date(app.winback_sent_at).getTime()) < 30 * 86400000) continue;

      // Send winback email
      if (resend && app.email) {
        try {
          await resend.emails.send({
            from: "APEX Financial <notifications@apex-financial.org>",
            to: [app.email],
            subject: `${app.first_name}, are you still interested in APEX?`,
            html: `
              <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
                <div style="background:linear-gradient(135deg,#059669,#047857);padding:30px;border-radius:10px 10px 0 0;">
                  <h1 style="color:white;margin:0;">Hey ${app.first_name},</h1>
                </div>
                <div style="background:#f9fafb;padding:30px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 10px 10px;">
                  <p>Life gets busy. I get it.</p>
                  <p>But some of the agents who started after you are now in the field earning real income. The door is still open for you.</p>
                  <p>One email or call and we pick up exactly where you left off.</p>
                  <p style="margin:24px 0;"><a href="https://rebuild-brighten-sparkle.lovable.app/apply" style="background:#059669;color:white;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:bold;">I'm Ready to Start Again →</a></p>
                  <p>— Sam<br/><strong style="color:#059669;">Managing Partner, APEX Financial</strong></p>
                </div>
              </div>`,
          });
        } catch (e) { console.error("Winback email failed:", e); }
      }

      // Send winback SMS
      if (app.phone) {
        try {
          await fetch(`${supabaseUrl}/functions/v1/send-sms-auto-detect`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
            body: JSON.stringify({
              phone: app.phone,
              message: `Hey ${app.first_name}, it's Sam from APEX. Still thinking about getting licensed? Reply YES and we'll make it happen. -Sam`,
            }),
          });
        } catch (e) { console.error("Winback SMS failed:", e); }
      }

      await supabase.from("applications")
        .update({ winback_sent_at: now.toISOString() })
        .eq("id", app.id);

      results.push(`${app.first_name} ${app.last_name}`);
    }

    console.log(`Win-back campaign complete. Contacted: ${results.length}`);
    return new Response(JSON.stringify({ success: true, contacted: results.length, names: results }), {
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (err: any) {
    console.error("send-winback error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
});
