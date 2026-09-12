// content-thumb — store a thumbnail for a content_clips row.
//
// The MacBook testimonial classifier (~/business-ops/scripts/apex-testimonial-classifier.py)
// indexes screenshots from Dropbox into content_clips as media='image'. The
// Library renders thumb_url from the public clip-thumbs bucket, and no machine
// on this side holds the service role key, so the upload goes through here:
// APEX bot token in, a JPEG under 400KB in, public URL out. Nothing else.
//
//   POST /functions/v1/content-thumb  { "clip_id": "<uuid>", "jpeg_b64": "<base64>" }
//   Authorization: Bearer <APEX_BOT_TOKEN>
//   -> { ok: true, thumb_url }

import { createClient } from "npm:@supabase/supabase-js@2.90.1";

const APEX_BOT_TOKEN = (Deno.env.get("APEX_BOT_TOKEN") ?? "").trim();
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const MAX_BYTES = 400_000;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);
  const auth = req.headers.get("Authorization") ?? "";
  const ok = (APEX_BOT_TOKEN && auth === `Bearer ${APEX_BOT_TOKEN}`) || (SERVICE_ROLE && auth === `Bearer ${SERVICE_ROLE}`);
  if (!ok) return json({ ok: false, error: "unauthorized" }, 401);

  const body = (await req.json().catch(() => ({}))) as { clip_id?: string; jpeg_b64?: string };
  const clipId = String(body.clip_id ?? "");
  if (!/^[0-9a-f-]{36}$/.test(clipId)) return json({ ok: false, error: "clip_id must be a uuid" }, 400);
  const b64 = String(body.jpeg_b64 ?? "");
  if (!b64) return json({ ok: false, error: "jpeg_b64 required" }, 400);
  let bytes: Uint8Array;
  try { bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); } catch { return json({ ok: false, error: "jpeg_b64 is not base64" }, 400); }
  if (bytes.length > MAX_BYTES) return json({ ok: false, error: `thumb over ${MAX_BYTES} bytes` }, 413);
  if (!(bytes[0] === 0xff && bytes[1] === 0xd8)) return json({ ok: false, error: "not a JPEG" }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const { data: row, error: rowErr } = await admin.from("content_clips").select("id").eq("id", clipId).maybeSingle();
  if (rowErr) return json({ ok: false, error: rowErr.message }, 500);
  if (!row) return json({ ok: false, error: "no such clip" }, 404);

  const objectPath = `${clipId}.jpg`;
  const { error: upErr } = await admin.storage.from("clip-thumbs").upload(objectPath, bytes, { contentType: "image/jpeg", upsert: true, cacheControl: "31536000" });
  if (upErr) return json({ ok: false, error: `upload: ${upErr.message}` }, 500);
  const thumb_url = `${SUPABASE_URL}/storage/v1/object/public/clip-thumbs/${objectPath}`;
  const { error: updErr } = await admin.from("content_clips").update({ thumb_url, thumbed_at: new Date().toISOString() }).eq("id", clipId);
  if (updErr) return json({ ok: false, error: `update: ${updErr.message}` }, 500);
  return json({ ok: true, thumb_url });
});
