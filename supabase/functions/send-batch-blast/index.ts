import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";
import { Resend } from "https://esm.sh/resend@2.0.0";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const CARRIER_GATEWAYS: Record<string, string> = {
  att: "txt.att.net",
  verizon: "vtext.com",
  tmobile: "tmomail.net",
  sprint: "messaging.sprintpcs.com",
  uscellular: "email.uscc.net",
  cricket: "sms.cricketwireless.net",
  metro: "mymetropcs.com",
  boost: "sms.myboostmobile.com",
};

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function logNotification(supabase: any, data: any) {
  try {
    await supabase.from("notification_log").insert(data);
  } catch (e) {
    console.error("Log failed:", e);
  }
}

async function trySendPush(supabaseUrl: string, serviceRoleKey: string, supabase: any, lead: any): Promise<boolean> {
  try {
    const { data: profile } = await supabase
      .from("profiles")
      .select("user_id")
      .ilike("email", lead.email)
      .maybeSingle();

    if (!profile?.user_id) return false;

    const pushResponse = await fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify({
        userId: profile.user_id,
        title: "Apex Financial Update 🚀",
        body: `Hey ${lead.first_name}! Check your email for important updates from Apex Financial.`,
        url: "/dashboard",
      }),
    });
    const pushResult = await pushResponse.json();
    const success = pushResult.sent > 0;

    await logNotification(supabase, {
      recipient_email: lead.email,
      channel: "push",
      title: "Batch Blast Push",
      message: `Push to ${lead.first_name} ${lead.last_name || ""}`,
      status: success ? "sent" : "failed",
      error_message: success ? null : "No push subscriptions",
      metadata: { trigger: "batch-blast", type: "push" },
    });

    return success;
  } catch (err: any) {
    console.error(`Push failed for ${lead.email}:`, err);
    return false;
  }
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });
    const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

    const { leadIds, type } = await req.json();

    if (!leadIds || !Array.isArray(leadIds) || leadIds.length === 0) {
      return new Response(JSON.stringify({ error: "leadIds required" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const stats = { push_sent: 0, sms_sent: 0, emailed: 0, failed: 0 };

    for (const id of leadIds) {
      let lead: any = null;

      if (type === "applicant") {
        const { data } = await supabase
          .from("applications")
          .select("id, email, first_name, last_name, license_status, phone, carrier")
          .eq("id", id)
          .maybeSingle();
        lead = data;
      } else {
        const { data } = await supabase
          .from("aged_leads")
          .select("id, email, first_name, last_name, phone, status")
          .eq("id", id)
          .maybeSingle();
        lead = data;
      }

      if (!lead || !lead.email) {
        stats.failed++;
        continue;
      }

      try {
        // 1. Push
        const pushOk = await trySendPush(supabaseUrl, serviceRoleKey, supabase, lead);
        if (pushOk) stats.push_sent++;

        // 2. Email
        if (type === "applicant") {
          const resp = await fetch(`${supabaseUrl}/functions/v1/send-licensing-instructions`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceRoleKey}` },
            body: JSON.stringify({
              email: lead.email,
              firstName: lead.first_name,
              licenseStatus: lead.license_status || "unlicensed",
            }),
          });
          const result = await resp.json();
          if (resp.ok && result.success) stats.emailed++;
          else stats.failed++;
        } else {
          const resp = await fetch(`${supabaseUrl}/functions/v1/send-aged-lead-email`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceRoleKey}` },
            body: JSON.stringify({ email: lead.email, firstName: lead.first_name }),
          });
          const result = await resp.json();
          if (resp.ok && !result.error) stats.emailed++;
          else stats.failed++;
        }

        // 3. SMS
        if (lead.phone) {
          if (lead.carrier && CARRIER_GATEWAYS[lead.carrier]) {
            const cleaned = lead.phone.replace(/\D/g, "").slice(-10);
            if (cleaned.length === 10) {
              try {
                const smsEmail = `${cleaned}@${CARRIER_GATEWAYS[lead.carrier]}`;
                await resend.emails.send({
                  from: "Apex Financial <notifications@apex-financial.org>",
                  to: [smsEmail],
                  subject: "",
                  text: `Hey ${lead.first_name}! Apex Financial sent you resources — check your email! 🚀`.substring(0, 160),
                });
                stats.sms_sent++;
              } catch { /* skip */ }
            }
          } else {
            try {
              const autoResp = await fetch(`${supabaseUrl}/functions/v1/send-sms-auto-detect`, {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceRoleKey}` },
                body: JSON.stringify({
                  phone: lead.phone,
                  message: `Hey ${lead.first_name}! Apex Financial has updates — check your email! 🚀`.substring(0, 160),
                  ...(type === "applicant" ? { applicationId: lead.id } : { agedLeadId: lead.id }),
                }),
              });
              const autoResult = await autoResp.json();
              if (autoResult.successCount > 0) stats.sms_sent++;
            } catch { /* skip */ }
          }
        }
      } catch (err: any) {
        console.error(`Batch item failed for ${lead.email}:`, err);
        stats.failed++;
      }

      await delay(200);
    }

    console.log(`Batch blast done (${type}): ${JSON.stringify(stats)}`);

    return new Response(
      JSON.stringify({ success: true, stats }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: any) {
    console.error("Error in send-batch-blast:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);
