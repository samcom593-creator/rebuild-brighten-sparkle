// instagram-dm-nudge — MP-305 Wave 3: the follow-up engine Sam's inbox never had.
//
// Every 10 minutes (pg_cron apex-instagram-dm-nudge) this asks the database for
// threads where the ball is in the prospect's court and nudges them, in Sam's
// voice, inside Meta's 24h messaging window:
//   nudge1  bot asked a question, 60+ min of silence, window still open
//   nudge2  business thread, 20+ h since their last message (window closing)
// Then it chases abandoned applications that came from Instagram and left an
// email: one recovery email, stamped only on a Resend id.
//
// Everything it sends goes through send-instagram-dm, which attaches the Meta
// receipt (mid) or the refusal to the row, so v_ig_followup_truth grades on
// deliveries, never on rows written. Candidates come from fn_ig_nudge_candidates()
// (single source of truth; the SQL excludes any thread Sam typed in).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
const MAX_SENDS_PER_RUN = 20;

const NUDGE1_BUSINESS = [
  "still there? one question and i'll get you going",
  "you went quiet on me 😂 you in or nah?",
  "lmk, i got you either way 🙏",
];
const NUDGE1_OPENER = ["no pressure, just lmk what you're here for 🙏"];
const NUDGE2 = ["window's closing on my end. you want in or nah? no pressure"];
const pick = (arr: string[], seed: string) => { let h = 0; for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0; return arr[h % arr.length]; };

Deno.serve(async (req) => {
  const expected = Deno.env.get("APEX_BOT_TOKEN") ?? "";
  if (!expected || (req.headers.get("authorization") ?? "") !== `Bearer ${expected}`) return json({ ok: false, error: "unauthorized" }, 401);
  const base = Deno.env.get("SUPABASE_URL") ?? "https://xrzweoneiieddzxogewk.supabase.co";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const sb = createClient(base, serviceKey, { auth: { persistSession: false } });
  const dryRun = new URL(req.url).searchParams.get("dry_run") === "1";

  const receipts: Array<Record<string, unknown>> = [];
  let sent = 0, failed = 0, emailed = 0;

  // ── DM nudges ──
  const { data: cands, error: cErr } = await sb.rpc("fn_ig_nudge_candidates");
  if (cErr) return json({ ok: false, error: `candidates: ${cErr.message}` }, 500);
  for (const c of (cands ?? []) as Array<{ external_id: string; sender_handle: string | null; stage: number; business: boolean; last_out_body: string | null }>) {
    if (sent + failed >= MAX_SENDS_PER_RUN) break;
    const text = c.stage === 2 ? pick(NUDGE2, c.external_id) : pick(c.business ? NUDGE1_BUSINESS : NUDGE1_OPENER, c.external_id);
    const tag = `nudge${c.stage}`;
    if (dryRun) { receipts.push({ external_id: c.external_id, handle: c.sender_handle, tag, text, dry_run: true }); continue; }
    try {
      const r = await fetch(`${base}/functions/v1/send-instagram-dm`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({ recipient_id: c.external_id, external_id: c.external_id, message: text, tag }),
      });
      const j = await r.json().catch(() => ({}));
      if (j?.ok) sent++; else failed++;
      receipts.push({ external_id: c.external_id, handle: c.sender_handle, tag, ok: !!j?.ok, id: j?.id ?? null, error: j?.error ?? null, kind: j?.kind ?? null });
    } catch (e) { failed++; receipts.push({ external_id: c.external_id, tag, ok: false, error: String(e).slice(0, 160) }); }
  }

  // ── Abandoned applications from Instagram that left an email ──
  // partial_applications.step = 'inbound_dm' rows are the brain's own thread stubs
  // (no form was ever started); only real form steps with an address count.
  const key = Deno.env.get("RESEND_API_KEY") ?? "";
  const { data: parts, error: pErr } = await sb.rpc("fn_ig_abandoned_partials");
  if (pErr) receipts.push({ partials_error: pErr.message });
  for (const p of (parts ?? []) as Array<{ id: string; email: string; first_name: string | null; step: string | null }>) {
    if (!key) break;
    if (dryRun) { receipts.push({ partial_id: p.id, email: p.email, dry_run: true }); continue; }
    const link = "https://apex-financial.org/apply?utm_source=instagram&utm_medium=dm&utm_campaign=recovery";
    try {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "Sam James <alerts@apex-financial.org>", reply_to: "info@kingofsales.net", to: [p.email],
          subject: "you started the application, sam",
          text: `yo${p.first_name ? ` ${p.first_name}` : ""}, it's sam from ig.\n\nyou started the application and didn't finish. takes 2 minutes, finish it here and i'll reach out:\n${link}\n\nif something's not clear just reply here.\n\nsam`,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j?.id) {
        await sb.from("partial_applications").update({ recovery_email_sent_at: new Date().toISOString() }).eq("id", p.id);
        emailed++; receipts.push({ partial_id: p.id, email: p.email, resend_id: j.id });
      } else receipts.push({ partial_id: p.id, email: p.email, error: JSON.stringify(j).slice(0, 160) });
    } catch (e) { receipts.push({ partial_id: p.id, error: String(e).slice(0, 160) }); }
  }

  return json({ ok: true, dry_run: dryRun, candidates: (cands ?? []).length, sent, failed, partials: (parts ?? []).length, emailed, receipts: receipts.slice(0, 40) });
});
