// youtube-comments — polls new top-level comments on Sam's latest videos and
// answers them publicly, the same brain as Instagram (manychat-webhook,
// channel "youtube_comment"): 🔥 / "appreciate you" on props, and for anyone
// with intent a public pointer to the one place the conversation can continue
// (Instagram DMs: YouTube has no DM API).
//
// Runs on pg_cron every 10 minutes once a channel is connected via youtube-auth.
// Quota: commentThreads.list = 1 unit per video, comments.insert = 50 units;
// 10 videos every 10 min + replies stays well inside the 10,000/day default.
//
// Auth: Authorization: Bearer <APEX_BOT_TOKEN>.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const VIDEOS_TO_WATCH = 25;
const BACKFILL_VIDEOS_PER_RUN = 60;      // ?backfill=1 walks the whole channel a page at a time (60 list units)
const BACKFILL_REPLIES_PER_RUN = 30;     // 30 x 50 units; 3 runs/day stays inside the 10k quota with the poller   // Sam posts several Shorts a day; comments land on older ones (25 list calls = 25 units per run)
const MAX_REPLIES_PER_RUN = 25;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function accessToken(sb: SupabaseClient, conn: { id: string; refresh_token: string; access_token: string | null; token_expires_at: string | null }): Promise<string | null> {
  const fresh = conn.access_token && conn.token_expires_at && new Date(conn.token_expires_at).getTime() - Date.now() > 120_000;
  if (fresh) return conn.access_token;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: Deno.env.get("YOUTUBE_CLIENT_ID") ?? "", client_secret: Deno.env.get("YOUTUBE_CLIENT_SECRET") ?? "", refresh_token: conn.refresh_token, grant_type: "refresh_token" }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) { console.error("[youtube-comments] refresh failed", JSON.stringify(j).slice(0, 300)); return null; }
  await sb.from("youtube_connections").update({ access_token: j.access_token, token_expires_at: new Date(Date.now() + Number(j.expires_in ?? 3600) * 1000).toISOString(), updated_at: new Date().toISOString() }).eq("id", conn.id);
  return j.access_token as string;
}

async function yt(path: string, token: string, init: RequestInit = {}) {
  const r = await fetch(`https://www.googleapis.com/youtube/v3/${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) } });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, body: j };
}

Deno.serve(async (req) => {
  const expected = Deno.env.get("APEX_BOT_TOKEN") ?? "";
  if (!expected || (req.headers.get("authorization") ?? "") !== `Bearer ${expected}`) return json({ ok: false, error: "unauthorized" }, 401);
  const sb = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false } });
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "https://xrzweoneiieddzxogewk.supabase.co";
  const backfill = new URL(req.url).searchParams.get("backfill") === "1";
  const maxReplies = backfill ? BACKFILL_REPLIES_PER_RUN : MAX_REPLIES_PER_RUN;

  // Every connected channel (Sam has more than one: Samuel James, APEX Nation).
  const { data: conns } = await sb.from("youtube_connections").select("id, channel_id, channel_title, refresh_token, access_token, token_expires_at").order("connected_at", { ascending: true });
  const channels = (conns ?? []) as Array<{ id: string; channel_id: string; channel_title: string | null; refresh_token: string; access_token: string | null; token_expires_at: string | null }>;
  if (!channels.length) return json({ ok: true, action: "skip", reason: "no_channel_connected" });

  let videosTotal = 0, seen = 0, newComments = 0, replied = 0, silent = 0, failed = 0;
  const receipts: Array<Record<string, unknown>> = [];
  const perChannel: Array<Record<string, unknown>> = [];
  for (const conn of channels) {
    const token = await accessToken(sb, conn);
    if (!token) { perChannel.push({ channel: conn.channel_title, error: "token_refresh_failed" }); continue; }

    // Latest uploads: channel -> uploads playlist -> newest N videos.
    const ch = await yt(`channels?part=contentDetails&id=${conn.channel_id}`, token);
    const uploads = ch.body?.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    if (!uploads) { perChannel.push({ channel: conn.channel_title, error: "no_uploads_playlist" }); continue; }
    let videoIds: string[] = [];
    if (!backfill) {
      const pl = await yt(`playlistItems?part=contentDetails&playlistId=${uploads}&maxResults=${VIDEOS_TO_WATCH}`, token);
      videoIds = (pl.body?.items ?? []).map((i: any) => i?.contentDetails?.videoId).filter(Boolean);
    } else {
      // Resume from the page the last backfill run stopped at (system_settings), wrap at the end.
      const cursorKey = `youtube_backfill_cursor_${conn.channel_id}`;
      const { data: cur } = await sb.from("system_settings").select("value").eq("key", cursorKey).limit(1);
      let pageToken: string | null = (cur?.[0]?.value as string | undefined) || null;
      let fetched = 0;
      while (fetched < BACKFILL_VIDEOS_PER_RUN) {
        const pl = await yt(`playlistItems?part=contentDetails&playlistId=${uploads}&maxResults=50${pageToken ? `&pageToken=${pageToken}` : ""}`, token);
        const ids = (pl.body?.items ?? []).map((i: any) => i?.contentDetails?.videoId).filter(Boolean);
        videoIds.push(...ids); fetched += 50;
        pageToken = pl.body?.nextPageToken ?? null;
        if (!pageToken) break;
      }
      const next = pageToken ?? "";
      if (cur?.length) await sb.from("system_settings").update({ value: next }).eq("key", cursorKey);
      else await sb.from("system_settings").insert({ key: cursorKey, value: next });
    }
    videosTotal += videoIds.length;

    for (const videoId of videoIds) {
      const th = await yt(`commentThreads?part=snippet,replies&videoId=${videoId}&order=time&maxResults=50&textFormat=plainText`, token);
      if (!th.ok) { console.warn("[youtube-comments] threads failed", videoId, th.status, JSON.stringify(th.body).slice(0, 200)); continue; }
      for (const t of th.body?.items ?? []) {
        seen++;
        const top = t?.snippet?.topLevelComment; const sn = top?.snippet; const commentId = top?.id;
        if (!commentId || !sn) continue;
        if (sn.authorChannelId?.value === conn.channel_id) continue;   // Sam's own comments
        const already = (t?.replies?.comments ?? []).some((r: any) => r?.snippet?.authorChannelId?.value === conn.channel_id);
        if (already) { await sb.from("youtube_comment_events").upsert({ comment_id: commentId, video_id: videoId, author_channel_id: sn.authorChannelId?.value ?? null, author_name: sn.authorDisplayName ?? null, text: sn.textOriginal ?? null, published_at: sn.publishedAt ?? null, intent: "already_answered" }, { onConflict: "comment_id" }); continue; }
        const { data: known } = await sb.from("youtube_comment_events").select("comment_id").eq("comment_id", commentId).limit(1);
        if (known?.length) continue;
        newComments++;
        const text: string = sn.textOriginal ?? sn.textDisplay ?? "";
        const author: string = sn.authorDisplayName ?? "";
        const authorId: string = sn.authorChannelId?.value ?? "";
        const row: Record<string, unknown> = { comment_id: commentId, video_id: videoId, author_channel_id: authorId, author_name: author, text, published_at: sn.publishedAt ?? null };

        let intent: string | null = null, publicReply: string | null = null;
        try {
          const cls = await fetch(`${supabaseUrl}/functions/v1/manychat-webhook`, {
            method: "POST", headers: { "Content-Type": "application/json", "x-manychat-secret": Deno.env.get("MANYCHAT_WEBHOOK_SECRET") ?? "" },
            body: JSON.stringify({ source: "youtube", channel: "youtube_comment", subscriber_id: authorId || commentId, sender_handle: author, sender_name: author, body: text, comment_id: commentId, media_id: videoId }),
          });
          const c = await cls.json().catch(() => ({}));
          intent = c?.intent ?? null; publicReply = c?.public_reply ?? null;
        } catch (e) { console.error("[youtube-comments] brain failed", e); }
        row.intent = intent; row.public_reply = publicReply;

        if (publicReply && replied < maxReplies) {
          const ins = await yt("comments?part=snippet", token, { method: "POST", body: JSON.stringify({ snippet: { parentId: commentId, textOriginal: publicReply } }) });
          if (ins.ok) { row.reply_comment_id = ins.body?.id ?? null; row.replied_at = new Date().toISOString(); replied++; }
          else {
            const msg = JSON.stringify(ins.body?.error ?? ins.status);
            // Quota exhausted: record nothing so this comment is retried after the reset, and stop the run.
            if (/quota/i.test(msg)) { console.warn("[youtube-comments] quota exhausted; stopping, comment left for retry"); return json({ ok: true, mode: backfill ? "backfill" : "latest", stopped: "quota", videos: videosTotal, comments_seen: seen, new_comments: newComments, replied, silent, failed, receipts: receipts.slice(0, 30) }); }
            row.error = msg.slice(0, 300); failed++;
          }
        } else if (!publicReply) silent++;
        await sb.from("youtube_comment_events").insert(row);
        receipts.push({ channel: conn.channel_title, video: videoId, author, text: text.slice(0, 60), intent, reply: publicReply, ok: !row.error });
      }
    }
    perChannel.push({ channel: conn.channel_title, videos: videoIds.length });
  }
  return json({ ok: true, mode: backfill ? "backfill" : "latest", channels: perChannel, videos: videosTotal, comments_seen: seen, new_comments: newComments, replied, silent, failed, receipts: receipts.slice(0, 30) });
});
