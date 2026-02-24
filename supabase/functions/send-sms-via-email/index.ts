import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";
import { Resend } from "https://esm.sh/resend@2.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));
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

function cleanPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  // Take last 10 digits (strip country code if present)
  return digits.slice(-10);
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { phone, carrier, message, agentId } = await req.json();

    let resolvedPhone = phone;
    let resolvedCarrier = carrier;

    // If agentId provided, resolve phone and carrier from DB
    if (agentId && (!resolvedPhone || !resolvedCarrier)) {
      const supabase = createClient(supabaseUrl, serviceRoleKey, {
        auth: { persistSession: false },
      });

      const { data: agent } = await supabase
        .from("agents")
        .select("user_id")
        .eq("id", agentId)
        .single();

      if (agent?.user_id) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("phone, carrier")
          .eq("user_id", agent.user_id)
          .single();

        if (profile) {
          resolvedPhone = resolvedPhone || profile.phone;
          resolvedCarrier = resolvedCarrier || profile.carrier;
        }
      }
    }

    if (!resolvedPhone || !resolvedCarrier || !message) {
      return new Response(
        JSON.stringify({ error: "Phone, carrier, and message are required" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const gateway = CARRIER_GATEWAYS[resolvedCarrier];
    if (!gateway) {
      return new Response(
        JSON.stringify({ error: `Unknown carrier: ${resolvedCarrier}` }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const cleanedPhone = cleanPhone(resolvedPhone);
    if (cleanedPhone.length !== 10) {
      return new Response(
        JSON.stringify({ error: "Invalid phone number - must be 10 digits" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const smsEmail = `${cleanedPhone}@${gateway}`;

    // Send plain text email to carrier gateway
    const { error: sendError } = await resend.emails.send({
      from: "Apex Financial <notifications@apex-financial.org>",
      to: [smsEmail],
      subject: "", // SMS gateways ignore subject
      text: message.substring(0, 160), // SMS limit
    });

    if (sendError) {
      console.error("Resend error:", sendError);
      throw new Error(sendError.message || "Failed to send SMS via email");
    }

    console.log(`SMS sent via email gateway to ${smsEmail}`);

    return new Response(
      JSON.stringify({ success: true, gateway: smsEmail }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: any) {
    console.error("Error in send-sms-via-email:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);
