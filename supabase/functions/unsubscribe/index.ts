// Public unsubscribe endpoint (verify_jwt = false). Two paths:
//
//   1. One-click (RFC 8058) from a mailbox provider's Unsubscribe button
//        POST /functions/v1/unsubscribe?u=<encoded-email>
//        body: List-Unsubscribe=One-Click
//      Also used by the apex-financial.org/unsubscribe page's button.
//
//   2. A human clicking the footer link
//        GET /functions/v1/unsubscribe?u=<encoded-email>
//      302s to https://apex-financial.org/unsubscribe?u=<same>, where a real page
//      asks for one click and then POSTs here.
//
// WHY GET NO LONGER UNSUBSCRIBES (ANCHOR, 2026-11-11):
//  - Supabase rewrites text/html from *.supabase.co to text/plain, so the old
//    confirmation page rendered as raw HTML source. To a recipient that looks
//    broken or like phishing, and one spam complaint can pause a whole sender.
//  - Mail scanners prefetch links. A GET that writes an opt-out silently
//    unsubscribes people who never clicked anything.
//
// WHY A FAILED WRITE IS NO LONGER 200: the old code discarded recordUnsubscribe's
// result, so a failed upsert still answered {ok:true} and the opt-out never
// landed. Now a failed write returns 500 (a one-click POST gets retried by the
// mailbox provider), is logged to bot_alerts, and the page shows a manual fallback.
//
// Bulk senders must still check _shared/email.ts#isUnsubscribed() before sending.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SITE_UNSUBSCRIBE_URL = "https://apex-financial.org/unsubscribe";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-client-info",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

export async function recordUnsubscribe(
  email: string,
  reason: string,
  source: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!email) return { ok: false, error: "no-email" };
  try {
    const { error } = await supabase
      .from("email_unsubscribes")
      .upsert({ email: email.toLowerCase(), reason, source }, { onConflict: "email" });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function decodeEmail(param: string | null): string {
  if (!param) return "";
  try {
    const dec = decodeURIComponent(param).trim();
    // One address, no spaces or angle brackets: this value is written to the table.
    return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(dec) ? dec : "";
  } catch {
    return "";
  }
}

async function logFailure(email: string, error: string) {
  // Record the address's domain only: the alert row is staff-visible, the address is not needed to fix the write.
  const domain = email.includes("@") ? email.split("@")[1] : "unknown";
  try {
    await supabase.from("bot_alerts").insert({
      source: "unsubscribe",
      event_type: "unsubscribe_write_failed",
      severity: "warn",
      subject: "Unsubscribe write failed",
      body: `An opt-out for an address at ${domain} did not save: ${error.slice(0, 300)}. The page told the person to email STOP.`,
      channels: [],
    });
  } catch (e) {
    console.error("unsubscribe: could not log the failure", e instanceof Error ? e.message : String(e));
  }
}

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);
  const raw = url.searchParams.get("u");

  if (req.method === "POST") {
    const email = decodeEmail(raw);
    if (!email) return json(400, { ok: false, error: "no-email" });
    const res = await recordUnsubscribe(email, "one_click", "list-unsubscribe-header");
    if (!res.ok) {
      console.error("unsubscribe: write failed", res.error);
      await logFailure(email, res.error);
      return json(500, { ok: false, error: "not_saved" });
    }
    return json(200, { ok: true });
  }

  if (req.method === "GET") {
    // No write on GET (link scanners). Send the person to a page that asks for one click.
    const target = raw ? `${SITE_UNSUBSCRIBE_URL}?u=${encodeURIComponent(raw)}` : SITE_UNSUBSCRIBE_URL;
    return new Response(null, { status: 302, headers: { ...corsHeaders, Location: target } });
  }

  return json(405, { ok: false, error: "method_not_allowed" });
});
