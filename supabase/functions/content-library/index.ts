// content-library — the media library as an API for editors and agents.
//
// Sam, 2026-09-07: "I should be able to have Codex / Claude / Borumi scrape
// videos from my actual website and use them as elements to make a video."
// This is the front door: search the indexed Dropbox archive and get direct
// download links, titles, tags, durations and previews as JSON. Auth is the
// APEX bot token (or service role) — never public.
//
//   GET  /functions/v1/content-library?q=drone%20sunset&folder=Reels&limit=20
//   POST /functions/v1/content-library { "q": "...", "folder": "YouTube", "limit": 50, "min_seconds": 5, "max_seconds": 60 }
//   Authorization: Bearer <APEX_BOT_TOKEN>
//
// download_url is a Dropbox temporary link to the ORIGINAL file (valid ~4h,
// re-minted every 3h). Nothing here copies bytes; the caller pulls straight
// from Dropbox's CDN.

import { createClient } from "npm:@supabase/supabase-js@2.90.1";

const APEX_BOT_TOKEN = (Deno.env.get("APEX_BOT_TOKEN") ?? "").trim();
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "access-control-allow-origin": "*" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type" } });
  const auth = req.headers.get("Authorization") ?? "";
  const ok = (APEX_BOT_TOKEN && auth === `Bearer ${APEX_BOT_TOKEN}`) || (SERVICE_ROLE && auth === `Bearer ${SERVICE_ROLE}`);
  if (!ok) return json({ ok: false, error: "unauthorized" }, 401);

  const url = new URL(req.url);
  const body = req.method === "POST" ? ((await req.json().catch(() => ({}))) as Record<string, unknown>) : {};
  const q = String(body.q ?? url.searchParams.get("q") ?? "").trim();
  const folder = String(body.folder ?? url.searchParams.get("folder") ?? "").trim() || null;
  const limit = Math.min(Math.max(Number(body.limit ?? url.searchParams.get("limit") ?? 50) || 50, 1), 500);
  const minS = Number(body.min_seconds ?? url.searchParams.get("min_seconds") ?? 0) || 0;
  const maxS = Number(body.max_seconds ?? url.searchParams.get("max_seconds") ?? 0) || 0;

  const db = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const { data, error } = await db.rpc("content_clips_search", { p_q: q, p_folder: folder, p_limit: 500 });
  if (error) return json({ ok: false, error: error.message }, 500);

  const rows = ((data ?? []) as Array<Record<string, unknown>>)
    .filter((r) => {
      const d = Number(r.duration_s ?? 0);
      return (!minS || d >= minS) && (!maxS || d <= maxS);
    })
    .slice(0, limit)
    .map((r) => ({
      id: r.id, path: r.path, name: r.name, folder: r.folder, kind: r.kind,
      title: r.title ?? null, tags: r.tags ?? [], description: r.description ?? null,
      duration_s: r.duration_s ?? null, width: r.width ?? null, height: r.height ?? null, size_bytes: r.size_bytes,
      modified_at: r.modified_at, thumb_url: r.thumb_url ?? null, preview_url: r.preview_url ?? null,
      download_url: r.download_expires_at && new Date(String(r.download_expires_at)).getTime() > Date.now() + 60_000 ? r.download_url : null,
      download_expires_at: r.download_expires_at ?? null,
    }));

  return json({ ok: true, count: rows.length, q, folder, clips: rows });
});
