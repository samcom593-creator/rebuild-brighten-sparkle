// Global Collaboration inbox for sell4daddy.com.
// The public form posts { name, email, fit_reason (message), page }. This function
// (verify_jwt=false) stores it as a brand_leads row (source "collaboration", which
// fires Sam's phone-push trigger) AND emails sam@sell4daddy.com via Resend so it
// literally lands in his inbox. reply_to is the sender, so Sam just hits reply.
const SB = Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND = Deno.env.get("RESEND_API_KEY") || "";
// Delivered DIRECT to Sam's Gmail. sam@sell4daddy.com forwards there via ForwardEmail
// (DNS-only), but on 2026-09-26 the first message sat at Resend last_event=sent for
// 30+ min without ForwardEmail ever returning 250. A forwarder in the path is one more
// thing that can defer a lead; the brand address stays the public-facing one.
const TO = "sam.com593@gmail.com";
const FROM = "King of Sales <noreply@apex-financial.org>";

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "content-type": "application/json" } });

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }

  const name = String(body.name || "").slice(0, 200).trim();
  const email = String(body.email || "").slice(0, 200).trim();
  const message = String(body.fit_reason || body.message || "").slice(0, 4000).trim();
  const page = String(body.page || "").slice(0, 200);

  if (!email || !message) return json({ error: "email and message required" }, 400);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "invalid email" }, 400);

  // 1) Store the lead — service role bypasses RLS and fires trg_brand_lead_alert (phone push).
  const errs: string[] = [];
  let stored = false;
  try {
    const ins = await fetch(SB + "/rest/v1/brand_leads", {
      method: "POST",
      headers: { apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ source: "collaboration", name: name || null, email, fit_reason: message, page }),
    });
    stored = ins.ok;
    if (!ins.ok) errs.push("store: http " + ins.status);
  } catch (e) { errs.push("store: " + ((e as Error)?.message ?? String(e))); }

  // 2) Email Sam so it hits his inbox. reply_to = sender for a one-tap reply.
  let emailed = false;
  if (RESEND) {
    try {
      const html =
        `<h2 style="font-family:system-ui,sans-serif">New collaboration inquiry</h2>` +
        `<p><b>Name:</b> ${esc(name || "—")}</p>` +
        `<p><b>Email:</b> ${esc(email)}</p>` +
        `<p><b>Message:</b><br>${esc(message).replace(/\n/g, "<br>")}</p>` +
        `<hr><p style="color:#888;font-size:12px">Sent from sell4daddy.com — Global Collaboration. Reply to answer them directly.</p>`;
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: "Bearer " + RESEND, "Content-Type": "application/json" },
        body: JSON.stringify({ from: FROM, to: [TO], reply_to: email, subject: `Collaboration — ${name || email}`, html }),
      });
      emailed = r.ok;
      if (!r.ok) errs.push("email: http " + r.status);
    } catch (e) { errs.push("email: " + ((e as Error)?.message ?? String(e))); }
  }

  // Never a bare false: the caller gets the reason, and a partial delivery says so.
  if (!stored && !emailed) return json({ error: "could not deliver", detail: errs }, 502);
  return json({ ok: true, stored, emailed, ...(errs.length ? { warnings: errs } : {}) });
});
