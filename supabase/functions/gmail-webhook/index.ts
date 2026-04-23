/**
 * gmail-webhook — inbound receiver for XCEL/SureLC/state-DOI emails forwarded
 * by Gmail → Zapier/Make/Apps-Script. Classifies the payload, stores it to
 * public.urgent_inbox, and triggers Discord fanout via route_urgent_inbox().
 *
 * Forwarder payload shape (accept any of these):
 *   { subject, from, body, bodySnippet, applicantEmail, receivedAt }
 *
 * Auth: shared secret header `x-apex-inbox-token` must match
 * system_settings.gmail_inbox_token OR env GMAIL_INBOX_TOKEN. Missing → 401.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-apex-inbox-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SRV = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function resolveToken(sb: ReturnType<typeof createClient>): Promise<string | null> {
  const env = Deno.env.get("GMAIL_INBOX_TOKEN");
  if (env) return env;
  const { data } = await sb.from("system_settings").select("value").eq("key","gmail_inbox_token").maybeSingle();
  return (data as any)?.value ?? null;
}

function emailFromFrom(from: string | undefined): string | null {
  if (!from) return null;
  const m = from.match(/<([^>]+)>/);
  return (m ? m[1] : from).trim().toLowerCase();
}

function domainOf(addr: string | null): string | null {
  if (!addr) return null;
  const at = addr.lastIndexOf("@");
  return at === -1 ? null : addr.slice(at + 1);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return new Response("method not allowed", { status: 405, headers: corsHeaders });

  const sb = createClient(SB_URL, SB_SRV);

  // ─── Auth ────────────────────────────────────────────────────────────────
  const provided = req.headers.get("x-apex-inbox-token") ?? "";
  const expected = await resolveToken(sb);
  if (!expected || provided !== expected) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: any;
  try { body = await req.json(); }
  catch { return new Response("bad json", { status: 400, headers: corsHeaders }); }

  const subject     = String(body.subject ?? "").slice(0, 500);
  const from        = String(body.from ?? "").slice(0, 300);
  const fromAddr    = emailFromFrom(from);
  const fromDomain  = domainOf(fromAddr);
  const fullBody    = String(body.body ?? body.bodyText ?? "").slice(0, 15000);
  const bodySnippet = String(body.bodySnippet ?? fullBody.slice(0, 800));
  const matchEmail  = String(body.applicantEmail ?? body.matchEmail ?? "").toLowerCase() || null;
  const receivedAt  = body.receivedAt ? new Date(body.receivedAt).toISOString() : new Date().toISOString();

  // Classify (delegates to the DB function so webhook + cron stay in sync)
  const { data: cls } = await sb.rpc("classify_urgent_kind", {
    p_subject: subject, p_body: fullBody,
  });
  const kind = (cls as unknown as string) ?? "other";

  const { data: inserted, error } = await sb.from("urgent_inbox").insert({
    source: "gmail",
    kind,
    subject,
    from_addr: fromAddr,
    from_domain: fromDomain,
    body_snippet: bodySnippet,
    match_email: matchEmail,
    received_at: receivedAt,
    payload: body,
  }).select("id").single();

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Fire-and-forget: immediate route attempt (don't block the webhook response)
  sb.rpc("route_urgent_inbox").then(() => {}).catch(() => {});

  return new Response(JSON.stringify({ ok: true, id: (inserted as any)?.id, kind }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
