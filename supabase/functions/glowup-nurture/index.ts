// glowup-nurture (MP-BRAND-ENGINE part 6). The 5-email Glow-Up sequence: one per ladder stage on days
// 1, 3, 5 and 7, then "pick your door" on day 10. Copy lives in glowup_nurture_emails.
//
// OFF until Sam approves the copy: this function sends nothing unless
// system_settings.glowup_nurture_enabled is exactly 'true'. The daily cron also skips the call while it is off.
// Auth: x-cron-key must equal system_settings.glowup_cron_key (verify_jwt=false; pg_cron has no user).
// Per lead: at most one sequence email per run and per 20 hours, in order, never to an unsubscribed
// address. A step is recorded only after the sender returns an id.
// POST { "dry_run": true } reports who is due without sending, whether the sequence is on or off.
import { sendEmail, isUnsubscribed, PERSONAL_FROM } from "../_shared/email.ts";
import { textToHtml } from "../_shared/glowup.ts";

const SB = Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const svc = { apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json" };
const MAX_PER_RUN = 50;
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });

interface Lead { id: string; first_name: string; email: string; created_at: string; nurture_step: number; nurture_last_at: string | null }
interface Step { step: number; day_offset: number; subject: string; body: string }

async function setting(key: string): Promise<string> {
  const r = await fetch(`${SB}/rest/v1/system_settings?key=eq.${key}&select=value`, { headers: svc });
  if (!r.ok) throw new Error(`settings read failed: ${r.status}`);
  return ((await r.json()) as { value: string }[])[0]?.value ?? "";
}
function sameKey(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
const unsubClient = { from: (t: string) => ({ select: (c: string) => ({ eq: (col: string, v: string) => ({ maybeSingle: async () => {
  const r = await fetch(`${SB}/rest/v1/${t}?${col}=eq.${encodeURIComponent(v)}&select=${c}&limit=1`, { headers: svc });
  if (!r.ok) return { data: null, error: { message: "http " + r.status } };
  const rows = await r.json();
  return { data: rows[0] ?? null, error: null };
} }) }) }) };

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  try {
    const given = (req.headers.get("x-cron-key") ?? "").trim();
    const expected = await setting("glowup_cron_key");
    if (!given || !expected || !sameKey(given, expected)) return json({ error: "wrong key" }, 401);

    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch { body = {}; }
    const dryRun = body.dry_run === true;
    const enabled = (await setting("glowup_nurture_enabled")) === "true";
    if (!enabled && !dryRun) return json({ enabled: false, sent: 0 });

    const [lr, sr] = await Promise.all([
      fetch(`${SB}/rest/v1/glowup_leads?nurture_step=lt.5&select=id,first_name,email,created_at,nurture_step,nurture_last_at&order=created_at.asc&limit=500`, { headers: svc }),
      fetch(`${SB}/rest/v1/glowup_nurture_emails?select=step,day_offset,subject,body&order=step.asc`, { headers: svc }),
    ]);
    if (!lr.ok || !sr.ok) return json({ error: "read failed", leads: lr.status, steps: sr.status }, 503);
    const leads = (await lr.json()) as Lead[];
    const steps = new Map(((await sr.json()) as Step[]).map((s) => [s.step, s]));
    const now = Date.now();

    const due = leads.filter((l) => {
      const next = steps.get(l.nurture_step + 1);
      if (!next) return false;
      if (now < new Date(l.created_at).getTime() + next.day_offset * 86_400_000) return false;
      return !l.nurture_last_at || now - new Date(l.nurture_last_at).getTime() > 20 * 3_600_000;
    }).slice(0, MAX_PER_RUN);

    if (dryRun) return json({ enabled, dry_run: true, due: due.length, by_step: due.reduce<Record<string, number>>((m, l) => { const k = String(l.nurture_step + 1); m[k] = (m[k] ?? 0) + 1; return m; }, {}) });

    let sent = 0, skipped = 0;
    const failures: string[] = [];
    for (const l of due) {
      const step = steps.get(l.nurture_step + 1)!;
      if (await isUnsubscribed(unsubClient, l.email.toLowerCase())) {
        // Stop the sequence for this address: mark it finished without sending.
        await fetch(`${SB}/rest/v1/glowup_leads?id=eq.${l.id}`, { method: "PATCH", headers: { ...svc, Prefer: "return=minimal" }, body: JSON.stringify({ nurture_step: 5 }) });
        skipped++; continue;
      }
      const text = step.body.replaceAll("{{first_name}}", l.first_name);
      const res = await sendEmail({ to: l.email, subject: step.subject, html: textToHtml(text), text, from: PERSONAL_FROM, unsubscribe_token: encodeURIComponent(l.email), tagName: `glowup_nurture_${step.step}` });
      if (!res.ok || !res.id) {
        if (res.refused) { await fetch(`${SB}/rest/v1/glowup_leads?id=eq.${l.id}`, { method: "PATCH", headers: { ...svc, Prefer: "return=minimal" }, body: JSON.stringify({ nurture_step: 5 }) }); skipped++; }
        else failures.push(`step ${step.step}: ${res.error ?? "no id"}`);
        continue;
      }
      const mark = await fetch(`${SB}/rest/v1/glowup_leads?id=eq.${l.id}&nurture_step=eq.${l.nurture_step}`, {
        method: "PATCH", headers: { ...svc, Prefer: "return=minimal" }, body: JSON.stringify({ nurture_step: step.step, nurture_last_at: new Date().toISOString() }),
      });
      if (mark.ok) sent++; else failures.push(`step ${step.step}: sent but not recorded (${mark.status})`);
    }
    return json({ enabled: true, due: due.length, sent, skipped, failures: failures.slice(0, 10) });
  } catch (e) {
    return json({ error: (e as Error)?.message ?? String(e) }, 500);
  }
});
