/**
 * send-sms-via-email — Twilio-free SMS via carrier email-to-SMS gateways.
 *
 * Fan-out upgrade: if carrier is unknown we send to all 5 major US gateways
 * at once. Exactly one delivers, the others bounce silently — recipient
 * still gets the SMS. No Twilio / Google Voice API needed.
 *
 * Modes:
 *   A) {phone, body}                 → immediate fan-out to major carriers
 *   B) {phone, body, carrier}        → targeted single-carrier send
 *   C) {agentId, body}               → resolve phone+carrier from profile
 *   D) {} (no phone)                 → drain public.sms_fallback_queue
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
// 2026-08-17: bumped off supabase-js@2.50.0 — esm.sh resolves transitive deps at
// request time, so that pin pinned nothing underneath it and now fails to resolve
// ws's optional native deps (bufferutil / utf-8-validate). The function died at
// BOOT, before the handler, so every call 500d and nothing recorded a reason.
// Measured 2026-08-17: send-notification 903/903 failures in 24h, poke-pusher
// 164/164, metricool-sync 3/3 — zero 200s. 2.90.1 is the version proven booting.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";
import { Resend } from "https://esm.sh/resend@2.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SMS_FROM = Deno.env.get("SMS_FROM") ?? "APEX <notifications@apex-financial.org>";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Every US carrier we know, keyed so system_settings or profiles.carrier can target one.
const CARRIER_GATEWAYS: Record<string, string[]> = {
  att:          ["txt.att.net"],
  verizon:      ["vtext.com"],
  tmobile:      ["tmomail.net"],
  sprint:       ["messaging.sprintpcs.com"],
  uscellular:   ["email.uscc.net"],
  cricket:      ["sms.cricketwireless.net"],
  metro:        ["mymetropcs.com"],
  boost:        ["sms.myboostmobile.com"],
  google_fi:    ["msg.fi.google.com"],
  virgin:       ["vmobl.com"],
};
// 5 carriers that cover >90% of US numbers
const FANOUT = ["verizon", "att", "tmobile", "sprint", "google_fi"];

function cleanPhone(phone: string): string {
  return phone.replace(/\D/g, "").slice(-10);
}

function buildGatewayAddresses(phone: string, carrier?: string | null): string[] {
  const ten = cleanPhone(phone);
  if (ten.length !== 10) return [];
  const keys = carrier && CARRIER_GATEWAYS[carrier] ? [carrier] : FANOUT;
  return keys.flatMap(k => CARRIER_GATEWAYS[k].map(domain => `${ten}@${domain}`));
}

async function fireOne(phone: string, body: string, carrier?: string | null): Promise<{
  ok: boolean; sent_to: string[]; error?: string; mode: "targeted" | "fanout";
}> {
  const addrs = buildGatewayAddresses(phone, carrier);
  if (addrs.length === 0) return { ok: false, sent_to: [], error: "invalid phone", mode: "targeted" };
  const mode: "targeted" | "fanout" = addrs.length === 1 ? "targeted" : "fanout";

  const { error } = await resend.emails.send({
    from:    SMS_FROM,
    to:      addrs,                                  // Resend supports batch-in-one-send
    subject: "",                                    // gateways strip subject
    text:    body.slice(0, 160),                    // SMS size
  } as any);

  if (error) return { ok: false, sent_to: addrs, error: (error as any)?.message ?? String(error), mode };
  return { ok: true, sent_to: addrs, mode };
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const sb = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  try {
    const payload = await req.json().catch(() => ({}));
    const { phone, carrier, message, body, agentId } = payload;
    const text = (message ?? body ?? "").toString();

    // ── Mode D: drain the queue ─────────────────────────────────────────
    if (!phone && !agentId && !text) {
      const { data: pending } = await sb
        .from("sms_fallback_queue")
        .select("*")
        .eq("status", "pending")
        .order("created_at")
        .limit(25);
      let okN = 0, failN = 0;
      for (const row of (pending ?? []) as any[]) {
        const r = await fireOne(row.phone, row.body, row.carrier_hint ?? undefined);
        if (r.ok) { await sb.from("sms_fallback_queue").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", row.id); okN++; }
        else      { await sb.from("sms_fallback_queue").update({ status: "failed", error: r.error ?? "unknown" }).eq("id", row.id); failN++; }
      }
      return new Response(JSON.stringify({ ok: true, drained: { processed: (pending ?? []).length, ok: okN, fail: failN } }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } });
    }

    // ── Mode C: resolve from agentId ────────────────────────────────────
    let resolvedPhone   = phone;
    let resolvedCarrier = carrier;
    if (agentId && !resolvedPhone) {
      const { data: agent } = await sb.from("agents").select("user_id, profile_id").eq("id", agentId).maybeSingle();
      if (agent) {
        const userKey = (agent as any).user_id ?? (agent as any).profile_id;
        if (userKey) {
          const { data: profile } = await sb.from("profiles").select("phone, carrier").eq("id", userKey).maybeSingle();
          if (profile) {
            resolvedPhone   ??= (profile as any).phone;
            resolvedCarrier ??= (profile as any).carrier;
          }
        }
      }
    }

    if (!resolvedPhone || !text) {
      return new Response(
        JSON.stringify({ error: "phone (or agentId) and body|message are required" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const r = await fireOne(resolvedPhone, text, resolvedCarrier);
    return new Response(JSON.stringify({ ok: r.ok, ...r }), {
      status: r.ok ? 200 : 502,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error?.message ?? "internal" }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } });
  }
};

serve(handler);
