// Send a nudge email to a single agent.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const MESSAGES: Record<string, { subject: string; body: string }> = {
  no_production_7d: {
    subject: "Let's get back in the game",
    body: "Quick check-in — haven't seen production from you in the last 7 days. Reply and let me know what's blocking you. I'm here to help.",
  },
  check_in: {
    subject: "Checking in",
    body: "Just a quick check-in. How's the week going? Any deals lined up?",
  },
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { agent_id, reason } = await req.json();
    if (!agent_id) {
      return new Response(JSON.stringify({ error: "agent_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: agent } = await supabase
      .from("agents")
      .select("id, profile:profiles!agents_profile_id_fkey(email, full_name)")
      .eq("id", agent_id)
      .maybeSingle();

    const profile = (agent as any)?.profile;
    const email = profile?.email;
    if (!email) {
      return new Response(JSON.stringify({ error: "No email on agent profile" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const msg = MESSAGES[reason] || MESSAGES.check_in;

    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) {
      return new Response(JSON.stringify({ error: "RESEND_API_KEY missing" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const resend = new Resend(resendKey);
    await resend.emails.send({
      from: "APEX Financial <notifications@apex-financial.org>",
      to: [email],
      subject: msg.subject,
      html: `<p>Hi ${profile?.full_name || ""},</p><p>${msg.body}</p><p>— APEX Team</p>`,
    });

    await supabase.from("email_delivery_log").insert({
      template: "agent_nudge",
      recipient_email: email,
      agent_id,
      subject: msg.subject,
      status: "sent",
      sent_at: new Date().toISOString(),
    });

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("[send-agent-nudge]", e);
    return new Response(JSON.stringify({ error: e?.message ?? "Internal error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
