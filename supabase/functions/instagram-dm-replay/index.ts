// instagram-dm-replay — the "backtracking event". Re-sends every assistant reply
// that died on a dead Instagram token, the moment a new token lands.
//
// Fired by trg_instagram_token_replay (AFTER INSERT/UPDATE of meta_instagram_token
// on system_settings) and callable by hand. Auth: Bearer <APEX_BOT_TOKEN> (vault
// apex_bot_token) or the service-role key.
//
// What it replays, and what it refuses:
//   - rows send-instagram-dm HELD (raw_payload.queued = "hold", reason token_dead),
//     plus — with ?include_failed=1 — the legacy send_failed rows whose error was
//     the token (the 2026-10-01..03 outage predates the hold path).
//   - one send per (person, message): the drain had multiplied each failure into a
//     fresh row every few hours (69 rows for one reply), so the group is collapsed
//     and every row in it is settled with the same verdict.
//   - comment-triggered replies go as PRIVATE REPLIES (recipient.comment_id) — Meta
//     allows those for 7 days after the comment; the public "just messaged you" is
//     posted under the comment only after the DM lands.
//   - plain DM replies go only if that person wrote within the last 24h (Meta's
//     RESPONSE window). Anything older is settled as "expired": a send that cannot
//     succeed is not attempted, and nothing is marked sent that was not.
//   - the token is probed FIRST; a dead token means zero attempts and an honest
//     "token_dead" verdict — never a storm of 190s.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { probeInstagramToken } from "../_shared/instagram-token-dead.ts";

const BASE = Deno.env.get("SUPABASE_URL") ?? "https://xrzweoneiieddzxogewk.supabase.co";
const SRK  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const COMMENT_REPLY_WINDOW_H = 7 * 24;
const DM_WINDOW_H = 24;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  const auth = req.headers.get("authorization") ?? "";
  const bot = Deno.env.get("APEX_BOT_TOKEN") ?? "";
  if (!(bot && auth === `Bearer ${bot}`) && !(SRK && auth === `Bearer ${SRK}`)) return json({ ok: false, error: "unauthorized" }, 401);

  const url = new URL(req.url);
  const includeFailed = url.searchParams.get("include_failed") === "1";
  const since = url.searchParams.get("since") ?? new Date(Date.now() - 14 * 86400000).toISOString();
  const dryRun = url.searchParams.get("dry_run") === "1";

  const sb = createClient(BASE, SRK, { auth: { persistSession: false } });
  const { data: tokRow } = await sb.from("system_settings").select("value").eq("key", "meta_instagram_token").maybeSingle();
  const token = typeof tokRow?.value === "string" ? tokRow.value.replace(/^"|"$/g, "") : null;
  const live = await probeInstagramToken(token);
  if (live.dead) return json({ ok: false, action: "token_dead", error: live.error, attempted: 0 });

  // Candidate rows: held, plus legacy token failures when asked.
  let q = sb.from("inbox_messages").select("id, external_id, body, created_at, raw_payload")
    .eq("source", "instagram").eq("direction", "outbound").gte("created_at", since).order("created_at", { ascending: true }).limit(2000);
  const { data: rows, error } = await q;
  if (error) return json({ ok: false, error: error.message }, 500);
  type Row = { id: string; external_id: string; body: string; created_at: string; raw_payload: Record<string, unknown> | null };
  const cands = (rows as Row[] ?? []).filter((r) => {
    const p = r.raw_payload ?? {};
    if (p.queued === "hold") return true;
    if (includeFailed && p.queued === true && p.reason === "send_failed" && /access token|session has been invalidated/i.test(String(p.error ?? ""))) return true;
    return false;
  });

  // Collapse to one send per (person, message); keep every row id so the whole
  // group settles together, and remember any comment_id the group ever carried
  // (the drain's retries dropped it).
  const groups = new Map<string, { external_id: string; body: string; ids: string[]; comment_id: string | null; newest: string }>();
  for (const r of cands) {
    const k = `${r.external_id}\u0000${r.body}`;
    const g = groups.get(k) ?? { external_id: r.external_id, body: r.body, ids: [], comment_id: null, newest: r.created_at };
    g.ids.push(r.id);
    const cid = (r.raw_payload?.comment_id as string | null) ?? null;
    if (cid && !g.comment_id) g.comment_id = cid;
    if (r.created_at > g.newest) g.newest = r.created_at;
    groups.set(k, g);
  }

  const receipts: Array<Record<string, unknown>> = [];
  let sent = 0, expired = 0, failed = 0;
  const now = Date.now();
  for (const g of groups.values()) {
    let mode: "comment" | "dm" | "expired" = "expired";
    let why = "";
    let commentAt: string | null = null;
    let publicReply: string | null = null;
    if (g.comment_id) {
      const { data: ev } = await sb.from("ig_comment_events").select("created_at, commented_at, public_reply, reply_id").eq("comment_id", g.comment_id).maybeSingle();
      commentAt = (ev?.commented_at as string | null) ?? (ev?.created_at as string | null) ?? null;
      if (!ev?.reply_id) {
        const { data: inb } = await sb.from("inbox_messages").select("raw_payload").eq("direction", "inbound").filter("raw_payload->>comment_id", "eq", g.comment_id).limit(1).maybeSingle();
        publicReply = ((inb?.raw_payload as Record<string, unknown> | null)?.public_reply as string | null) ?? (ev?.public_reply as string | null) ?? null;
      }
      const ageH = commentAt ? (now - new Date(commentAt).getTime()) / 3600000 : Infinity;
      if (ageH <= COMMENT_REPLY_WINDOW_H) mode = "comment"; else why = `comment ${ageH.toFixed(0)}h old (> ${COMMENT_REPLY_WINDOW_H}h)`;
    }
    if (mode === "expired" && !why) {
      const { data: lastIn } = await sb.from("inbox_messages").select("created_at").eq("direction", "inbound").eq("external_id", g.external_id).order("created_at", { ascending: false }).limit(1).maybeSingle();
      const ageH = lastIn?.created_at ? (now - new Date(lastIn.created_at as string).getTime()) / 3600000 : Infinity;
      if (ageH <= DM_WINDOW_H) mode = "dm"; else why = lastIn ? `last inbound ${ageH.toFixed(0)}h ago (> ${DM_WINDOW_H}h)` : "no inbound on record";
    }

    // Never replay into a thread Sam has taken over himself: the dry run on
    // 2026-10-03 queued "yo this is sam's assistant, brand stuff goes..." at a
    // friend Sam was mid-conversation with (intent sam_thread). The brain's own
    // hand-off rule is 14 days; the same window applies here.
    if (mode !== "expired") {
      const { data: his } = await sb.from("inbox_messages").select("id").eq("external_id", g.external_id).in("intent", ["sam_thread", "sam_manual"]).gte("created_at", new Date(now - 14 * 86400000).toISOString()).limit(1);
      if (his?.length) { mode = "expired"; why = "sam is handling this thread himself"; }
    }
    let verdict: Record<string, unknown> = { replayed: false, mode, why };
    if (mode !== "expired" && !dryRun) {
      const payload = mode === "comment" ? { comment_id: g.comment_id, external_id: g.external_id, message: g.body } : { recipient_id: g.external_id, message: g.body };
      const r = await fetch(`${BASE}/functions/v1/send-instagram-dm`, { method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SRK}` }, body: JSON.stringify(payload) });
      const j = await r.json().catch(() => ({}));
      if (j?.ok) {
        sent++; verdict = { replayed: true, mode, message_id: j.id ?? null };
        if (mode === "comment" && publicReply) {
          const pr = await fetch(`${BASE}/functions/v1/send-instagram-dm`, { method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SRK}` }, body: JSON.stringify({ comment_id: g.comment_id, external_id: g.external_id, public: true, message: publicReply }) });
          const pj = await pr.json().catch(() => ({}));
          verdict.public_reply_id = pj?.id ?? null;
          if (pj?.ok) await sb.from("ig_comment_events").update({ reply_id: pj.id ?? null, public_reply: publicReply, dm_sent: true }).eq("comment_id", g.comment_id);
        } else if (mode === "comment") {
          await sb.from("ig_comment_events").update({ dm_sent: true }).eq("comment_id", g.comment_id);
        }
      } else { failed++; verdict = { replayed: false, mode, error: String(j?.error ?? `HTTP ${r.status}`).slice(0, 200) }; }
    } else if (mode === "expired") expired++;

    if (!dryRun) {
      // Settle every row in the group. The send above wrote its own fresh row
      // (success: none; failure: a new queued/held row), so these just stop being
      // candidates — never relabelled as sent.
      const settle = verdict.replayed ? "replayed" : mode === "expired" ? "expired" : "replay_failed";
      for (const id of g.ids) {
        const { data: cur } = await sb.from("inbox_messages").select("raw_payload").eq("id", id).maybeSingle();
        await sb.from("inbox_messages").update({ raw_payload: { ...(cur?.raw_payload as Record<string, unknown> ?? {}), queued: settle, replay_at: new Date().toISOString(), replay_why: why || null } }).eq("id", id);
      }
    }
    receipts.push({ external_id: g.external_id, rows: g.ids.length, comment_id: g.comment_id, text: g.body.slice(0, 60), ...verdict });
  }

  return json({ ok: true, dry_run: dryRun, token_user: live.username, candidates: cands.length, groups: groups.size, sent, expired, failed, receipts });
});
