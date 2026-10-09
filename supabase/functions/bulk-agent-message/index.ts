// Bulk SMS or Email to a list of agents.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { requireSendAuth } from "../_shared/require-send-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // PL-WIB-BULK-SENDERS-AUTH (2026-10-08). verify_jwt = false and, until this
  // commit, no credential read: a bare POST {} with no Authorization header
  // reached the body validation (400, nothing sent). The caller chose the agents
  // and the message, and the message goes into the HTML unescaped, so anyone
  // holding agent ids could mail or text the roster "A message from your
  // manager" from notifications@apex-financial.org.
  //
  // Floor is admin_or_manager. Callers: AgentManagement (requireAdmin route) on
  // the admin's JWT; AgentPipeline (any signed-in user) sends a body this
  // function has never accepted (applicationIds, no channel or message), so it
  // got a 400 before this gate and gets a 401/403 or 400 now. No pg, cron or
  // edge caller; 0 POSTs in 24h of function_edge_logs; 0 bulk_* rows ever in
  // email_delivery_log.
  const auth = await requireSendAuth(req);
  if (!auth.ok) {
    return new Response(JSON.stringify({ error: auth.error }), {
      status: auth.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const { agent_ids, channel, message } = await req.json();
    if (!Array.isArray(agent_ids) || agent_ids.length === 0 || !message || !channel) {
      return new Response(JSON.stringify({ error: "agent_ids[], channel, message required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (channel !== "sms" && channel !== "email") {
      return new Response(JSON.stringify({ error: "channel must be sms or email" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: agents } = await supabase
      .from("agents")
      .select("id, profile:profiles!agents_profile_id_fkey(email, phone, full_name)")
      .in("id", agent_ids);

    const resendKey = Deno.env.get("RESEND_API_KEY");
    const resend = resendKey ? new Resend(resendKey) : null;
    let sent = 0, failed = 0;

    for (const a of (agents || [])) {
      const profile = (a as any).profile;
      const to = channel === "sms" ? profile?.phone : profile?.email;
      if (!to) { failed++; continue; }

      try {
        if (channel === "email") {
          if (!resend) throw new Error("RESEND_API_KEY missing");
          await resend.emails.send({
            from: "Galaxy Financial <notifications@apex-financial.org>",
            to: [to],
            subject: "A message from your manager",
            html: `<p>${message.replace(/\n/g, "<br>")}</p>`,
          });
        } else {
          // Use SMS-via-email gateway (Email-to-SMS architecture)
          await supabase.functions.invoke("send-sms-via-email", {
            body: { to, message },
          });
        }
        sent++;
        await supabase.from("email_delivery_log").insert({
          template: "bulk_" + channel,
          recipient_email: channel === "email" ? to : (profile?.email || ""),
          agent_id: a.id,
          subject: "Bulk " + channel,
          status: "sent",
          sent_at: new Date().toISOString(),
        });
      } catch (e) {
        console.error(`[bulk-agent-message] failed for ${(a as any).id}:`, e);
        failed++;
      }
    }

    return new Response(JSON.stringify({ sent, failed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("[bulk-agent-message]", e);
    return new Response(JSON.stringify({ error: e?.message ?? "Internal error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
