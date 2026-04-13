import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const RESEND_URL = "https://api.resend.com/emails";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const resendKey = Deno.env.get("RESEND_API_KEY");
    const supabase = createClient(supabaseUrl, serviceKey);

    const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

    const { data: droppedLeads } = await supabase
      .from("applications")
      .select("id, first_name, last_name, email, phone, created_at, assigned_agent_id")
      .is("contacted_at", null)
      .is("terminated_at", null)
      .is("contracted_at", null)
      .lt("created_at", fortyEightHoursAgo)
      .order("created_at", { ascending: true });

    if (!droppedLeads || droppedLeads.length === 0) {
      return new Response(JSON.stringify({ message: "No dropped leads" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Notify Sam with full list
    if (resendKey) {
      const leadRows = droppedLeads.map(l => {
        const hoursWaiting = Math.round((Date.now() - new Date(l.created_at).getTime()) / 3600000);
        return `<tr><td style="padding:8px;border-bottom:1px solid #1e293b">${l.first_name} ${l.last_name}</td><td style="padding:8px;border-bottom:1px solid #1e293b">${l.email}</td><td style="padding:8px;border-bottom:1px solid #1e293b">${l.phone || "N/A"}</td><td style="padding:8px;border-bottom:1px solid #1e293b;color:#ef4444;font-weight:bold">${hoursWaiting}h</td></tr>`;
      }).join("");

      await fetch(RESEND_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "APEX Alerts <alerts@apex-financial.org>",
          to: ["sam@apex-financial.org"],
          subject: `⚠️ ${droppedLeads.length} Dropped Leads — No contact in 48+ hours`,
          html: `<div style="background:#030712;color:white;font-family:sans-serif;padding:32px;max-width:600px;margin:0 auto">
            <h2 style="color:#ef4444">⚠️ ${droppedLeads.length} Dropped Leads</h2>
            <p style="color:rgba(255,255,255,0.7)">These applicants have NOT been contacted in 48+ hours:</p>
            <table style="width:100%;color:white;font-size:13px"><thead><tr><th style="text-align:left;padding:8px;color:#22d3a5">Name</th><th style="text-align:left;padding:8px;color:#22d3a5">Email</th><th style="text-align:left;padding:8px;color:#22d3a5">Phone</th><th style="text-align:left;padding:8px;color:#22d3a5">Waiting</th></tr></thead><tbody>${leadRows}</tbody></table>
            <a href="https://rebuild-brighten-sparkle.lovable.app/dashboard/applicants" style="display:block;text-align:center;background:#22d3a5;color:#030712;padding:14px;border-radius:8px;font-weight:700;text-decoration:none;margin-top:24px">VIEW IN CRM →</a>
          </div>`,
        }),
      }).catch(console.error);
    }

    // Auto-send follow-up SMS to each dropped lead
    let smsCount = 0;
    for (const lead of droppedLeads) {
      if (lead.phone) {
        await fetch(`${supabaseUrl}/functions/v1/send-sms-auto-detect`, {
          method: "POST",
          headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            to: lead.phone,
            message: `Hi ${lead.first_name}! This is APEX Financial following up on your application. We'd love to connect — reply or call us at your convenience.`,
          }),
        }).catch(console.error);
        smsCount++;
      }

      // Log
      await supabase.from("notification_log").insert({
        notification_type: "dropped_lead_followup",
        recipient_email: lead.email,
        recipient_phone: lead.phone,
        subject: "Auto follow-up: dropped lead",
        body: `Auto follow-up sent to ${lead.first_name} ${lead.last_name} after 48h no contact`,
        application_id: lead.id,
        channel: "sms",
        status: "sent",
      });
    }

    return new Response(JSON.stringify({ success: true, droppedLeads: droppedLeads.length, smsSent: smsCount }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
