// Public unsubscribe endpoint. Handles two paths:
//
//   1. One-click (RFC 8058) from the Gmail "Unsubscribe" button
//        POST /functions/v1/unsubscribe  (body: List-Unsubscribe=One-Click)
//        Query string carries ?u=<encoded-email> so we know who.
//
//   2. Human-visible GET fallback
//        GET /functions/v1/unsubscribe?u=<encoded-email>
//        Returns a tiny HTML confirmation page.
//
// Either path writes an email_unsubscribes row. Bulk senders must check
// _shared/email.ts#isUnsubscribed() before sending.
//
// No auth required — this endpoint is intentionally public so mail clients
// and humans can both hit it.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

function confirmationPage(email: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Unsubscribed</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;max-width:520px;margin:80px auto;padding:0 20px;color:#111827;text-align:center}
  h1{font-size:28px;margin:0 0 12px}
  p{color:#6b7280;line-height:1.6}
  .chk{font-size:48px}
  a{color:#2563eb}
</style></head>
<body>
<div class="chk">\u2713</div>
<h1>You're unsubscribed</h1>
<p>${email ? `<strong>${email}</strong> will no longer receive marketing or nudge emails from APEX Financial.` : "You'll no longer receive marketing emails from APEX Financial."}</p>
<p style="font-size:13px">Transactional messages (password resets, deal receipts) will still reach you. Reply to any email to reach Sam directly.</p>
<p><a href="https://apex-financial.org">\u2190 Back to apex-financial.org</a></p>
</body></html>`;
}

async function recordUnsubscribe(email: string, reason: string, source: string) {
  if (!email) return { ok: false, error: "no-email" };
  try {
    const { error } = await supabase
      .from("email_unsubscribes")
      .upsert({ email: email.toLowerCase(), reason, source }, { onConflict: "email" });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}

function decodeEmail(param: string | null): string {
  if (!param) return "";
  try {
    const dec = decodeURIComponent(param);
    return dec.includes("@") ? dec : "";
  } catch {
    return "";
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);
  const email = decodeEmail(url.searchParams.get("u"));

  if (req.method === "POST") {
    // Gmail/Yahoo one-click — body is form-encoded or empty; we trust the ?u param.
    await recordUnsubscribe(email, "one_click", "list-unsubscribe-header");
    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // GET — human-visible confirmation.
  await recordUnsubscribe(email, "manual", "link-click");
  return new Response(confirmationPage(email), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" },
  });
});
