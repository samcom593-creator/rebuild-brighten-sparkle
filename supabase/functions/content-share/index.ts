// content-share — public, token-gated view of a shared clip set.
// GET /functions/v1/content-share?t=<token> -> { ok, label, clips:[{title, thumb_url, preview_url, download_url, duration_s, ...}] }
// The token is the only credential; a share can expire. Counts views.
import { createClient } from "npm:@supabase/supabase-js@2.90.1";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? ""; const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const H = { "content-type": "application/json", "access-control-allow-origin": "*", "access-control-allow-headers": "content-type" };
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: H });
  const t = (new URL(req.url).searchParams.get("t") ?? "").trim();
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(t)) return new Response(JSON.stringify({ ok: false, error: "bad token" }), { status: 400, headers: H });
  const db = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const { data: share } = await db.from("content_shares").select("token, label, clip_ids, expires_at, view_count").eq("token", t).maybeSingle();
  if (!share || (share.expires_at && new Date(share.expires_at).getTime() < Date.now())) return new Response(JSON.stringify({ ok: false, error: "not found or expired" }), { status: 404, headers: H });
  const { data: clips } = await db.from("content_clips")
    .select("id, name, path, folder, kind, title, tags, description, duration_s, width, height, size_bytes, thumb_url, preview_url, download_url, download_expires_at, phone_url, phone_bytes")
    .in("id", share.clip_ids as string[]);
  await db.from("content_shares").update({ view_count: (share.view_count ?? 0) + 1, last_viewed_at: new Date().toISOString() }).eq("token", t);
  const now = Date.now() + 60_000;
  const rows = (clips ?? []).map((c) => ({ ...c, download_url: c.download_expires_at && new Date(c.download_expires_at).getTime() > now ? c.download_url : null }));
  return new Response(JSON.stringify({ ok: true, label: share.label, expires_at: share.expires_at, clips: rows }), { headers: H });
});
