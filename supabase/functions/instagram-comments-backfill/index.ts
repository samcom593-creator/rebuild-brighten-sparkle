// instagram-comments-backfill — walks @sell4daddy's recent posts and answers the
// comments nobody replied to (the live webhook only sees comments as they arrive).
// Same brain as live comments (manychat-webhook, channel "comment"): a matching
// public reply, and a private DM for real asks when Instagram still allows it
// (private replies only within 7 days of the comment).
//
// pg_cron every 30 min. Auth: Bearer APEX_BOT_TOKEN. ?posts=N (default 30).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const MAX_REPLIES_PER_RUN = 25;
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  const expected = Deno.env.get("APEX_BOT_TOKEN") ?? "";
  if (!expected || (req.headers.get("authorization") ?? "") !== `Bearer ${expected}`) return json({ ok: false, error: "unauthorized" }, 401);
  const sb = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false } });
  const base = Deno.env.get("SUPABASE_URL") ?? "https://xrzweoneiieddzxogewk.supabase.co";
  const posts = Math.min(60, Number(new URL(req.url).searchParams.get("posts") ?? 30));

  const { data: st } = await sb.from("system_settings").select("value").eq("key", "meta_instagram_token").limit(1);
  const token = String(st?.[0]?.value ?? "").trim().replace(/^"|"$/g, "");
  if (!token) return json({ ok: false, error: "no_token" });
  const g = async (path: string) => { const r = await fetch(`https://graph.instagram.com/v21.0/${path}${path.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(token)}`); return r.json(); };

  const me = await g("me?fields=id,username");
  const myId = String(me?.id ?? ""); const myName = String(me?.username ?? "sell4daddy");
  const media = await g(`me/media?fields=id,caption,timestamp&limit=${posts}`);
  let seen = 0, answered = 0, dms = 0, skipped = 0;
  const receipts: Array<Record<string, unknown>> = [];

  for (const m of (media?.data ?? []) as Array<{ id: string }>) {
    if (answered >= MAX_REPLIES_PER_RUN) break;
    let url: string | null = `${m.id}/comments?fields=id,text,username,from{id,username},timestamp,replies{username,from{username}}&limit=50`;
    let pages = 0;
    while (url && pages < 4 && answered < MAX_REPLIES_PER_RUN) {
      const page = await g(url); pages++;
      for (const c of (page?.data ?? []) as Array<{ id: string; text: string; username?: string; from?: { id?: string; username?: string }; timestamp: string; replies?: { data: Array<{ username?: string; from?: { username?: string } }> } }>) {
        seen++;
        const who = c.from?.username ?? c.username ?? "";
        if (!c.text || !who || who === myName) continue;
        if ((c.replies?.data ?? []).some((r) => (r.from?.username ?? r.username) === myName)) continue;           // already answered (by Sam or the bot)
        const { data: known } = await sb.from("ig_comment_events").select("comment_id").eq("comment_id", c.id).limit(1);
        if (known?.length) continue;
        const ageDays = (Date.now() - new Date(c.timestamp).getTime()) / 86400000;
        const row: Record<string, unknown> = { comment_id: c.id, media_id: m.id, username: who, text: c.text, commented_at: c.timestamp };
        let d: any = {};
        try {
          const r = await fetch(`${base}/functions/v1/manychat-webhook`, {
            method: "POST", headers: { "Content-Type": "application/json", "x-manychat-secret": Deno.env.get("MANYCHAT_WEBHOOK_SECRET") ?? "" },
            body: JSON.stringify({ source: "instagram", channel: "comment", subscriber_id: `igc:${c.from?.id ?? who}`, sender_handle: `@${who}`, body: c.text, comment_id: c.id, media_id: m.id }),
          });
          d = await r.json();
        } catch (e) { row.error = String(e).slice(0, 200); }
        row.intent = d?.intent ?? null; row.public_reply = d?.public_reply ?? null;
        if (d?.public_reply) {
          const r = await fetch(`https://graph.instagram.com/v21.0/${c.id}/replies`, { method: "POST", headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ message: d.public_reply }) });
          const j = await r.json().catch(() => ({}));
          if (r.ok) { row.reply_id = j?.id ?? null; answered++; } else row.error = JSON.stringify(j?.error ?? r.status).slice(0, 200);
        } else skipped++;
        if (d?.auto_reply && ageDays < 7) {
          const r = await fetch(`${base}/functions/v1/send-instagram-dm`, { method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""}` }, body: JSON.stringify({ comment_id: c.id, external_id: `igc:${c.from?.id ?? who}`, message: d.auto_reply }) });
          const j = await r.json().catch(() => ({}));
          row.dm_sent = !!j?.ok; if (j?.ok) dms++;
        }
        await sb.from("ig_comment_events").insert(row);
        receipts.push({ user: who, text: c.text.slice(0, 60), reply: d?.public_reply ?? null, dm: !!row.dm_sent });
        await new Promise((res) => setTimeout(res, 1500));   // human pacing
        if (answered >= MAX_REPLIES_PER_RUN) break;
      }
      url = page?.paging?.next ? String(page.paging.next).replace(/^https:\/\/graph\.instagram\.com\/v[\d.]+\//, "").replace(/&?access_token=[^&]+/, "") : null;
    }
  }
  return json({ ok: true, posts: (media?.data ?? []).length, comments_seen: seen, answered, dms, skipped, receipts: receipts.slice(0, 40) });
});
