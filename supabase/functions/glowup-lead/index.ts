// glowup-lead (MP-BRAND-ENGINE part 6). Public form endpoint for sell4daddy.com/glowup.
// Stores one glowup_leads row per email (tagged by ladder stage and utm), then emails the checklist
// through the shared sender. verify_jwt=false: the page has no session.
//
// Not a relay: the only thing this endpoint can send is the fixed checklist, to the address submitted,
// once per address ever (checklist_sent_at). A repeat submit updates the row and sends nothing.
// The page shows the checklist on screen whatever this returns, so a failed email never blocks the lead.
import { sendEmail, isUnsubscribed, PERSONAL_FROM } from "../_shared/email.ts";
import { checklistEmail } from "../_shared/glowup.ts";

const SB = Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const svc = { apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json" };

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "content-type": "application/json" } });
const clean = (v: unknown, n: number) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n);

interface LeadRow { id: string; checklist_sent_at: string | null }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
  if (clean(body.website, 50)) return json({ ok: true }); // honeypot: a bot filled the hidden field

  const first_name = clean(body.first_name, 60);
  const email = clean(body.email, 200).toLowerCase();
  const phone = clean(body.phone, 30);
  const stage = Number(body.stage);
  if (first_name.length < 1) return json({ error: "first name required" }, 400);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) return json({ error: "valid email required" }, 400);
  if (phone.replace(/\D/g, "").length < 10) return json({ error: "phone required" }, 400);
  if (![1, 2, 3, 4].includes(stage)) return json({ error: "stage must be 1 to 4" }, 400);

  const row = {
    first_name, email, phone, stage,
    utm_source: clean(body.utm_source, 80) || null, utm_medium: clean(body.utm_medium, 80) || null,
    utm_campaign: clean(body.utm_campaign, 80) || null, utm_content: clean(body.utm_content, 80) || null,
    page: clean(body.page, 200) || null,
  };

  // One row per email. A returning lead keeps the first-touch utm and the original created_at.
  const found = await fetch(`${SB}/rest/v1/glowup_leads?email=eq.${encodeURIComponent(email)}&select=id,checklist_sent_at`, { headers: svc });
  if (!found.ok) return json({ error: "lookup failed", status: found.status }, 503);
  let lead = ((await found.json()) as LeadRow[])[0] ?? null;
  if (lead) {
    const up = await fetch(`${SB}/rest/v1/glowup_leads?id=eq.${lead.id}`, {
      method: "PATCH", headers: { ...svc, Prefer: "return=minimal" }, body: JSON.stringify({ first_name, phone, stage }),
    });
    if (!up.ok) return json({ error: "not saved", status: up.status }, 502);
  } else {
    const ins = await fetch(`${SB}/rest/v1/glowup_leads`, { method: "POST", headers: { ...svc, Prefer: "return=representation" }, body: JSON.stringify(row) });
    if (!ins.ok) return json({ error: "not saved", status: ins.status, detail: (await ins.text()).slice(0, 200) }, 502);
    lead = ((await ins.json()) as LeadRow[])[0] ?? null;
    if (!lead) return json({ error: "not saved: the write returned no row" }, 502);
  }

  if (lead.checklist_sent_at) return json({ ok: true, saved: true, emailed: false, reason: "already sent" });

  const optedOut = await isUnsubscribed(
    { from: (t: string) => ({ select: (c: string) => ({ eq: (col: string, v: string) => ({ maybeSingle: async () => {
      const r = await fetch(`${SB}/rest/v1/${t}?${col}=eq.${encodeURIComponent(v)}&select=${c}&limit=1`, { headers: svc });
      if (!r.ok) return { data: null, error: { message: "http " + r.status } };
      const rows = await r.json();
      return { data: rows[0] ?? null, error: null };
    } }) }) }) },
    email,
  );
  if (optedOut) return json({ ok: true, saved: true, emailed: false, reason: "unsubscribed" });

  const mail = checklistEmail(first_name, stage);
  const sent = await sendEmail({ to: email, subject: mail.subject, html: mail.html, text: mail.text, from: PERSONAL_FROM, unsubscribe_token: encodeURIComponent(email), tagName: "glowup_checklist" });
  if (!sent.ok || !sent.id) return json({ ok: true, saved: true, emailed: false, reason: sent.error ?? "the sender returned no id" });

  const mark = await fetch(`${SB}/rest/v1/glowup_leads?id=eq.${lead.id}`, {
    method: "PATCH", headers: { ...svc, Prefer: "return=minimal" }, body: JSON.stringify({ checklist_sent_at: new Date().toISOString(), checklist_email_id: sent.id }),
  });
  return json({ ok: true, saved: true, emailed: true, receipt_saved: mark.ok });
});
