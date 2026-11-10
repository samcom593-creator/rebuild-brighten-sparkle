// submit-licensing-proof (MP-LICENSING-PROOF, 2026-11-10)
//
// Sam: unlicensed applicants buy the XCEL course, then submit a screenshot as proof
// to unlock booking their licensing call. Applicants are usually ANON on /status/:id,
// so the write path is here (service role, verify_jwt off), gated by a real
// application_id, never a direct table/storage grant. Stores the image in the private
// licensing-proofs bucket and records one row in licensing_course_proofs.
//
// WP2 (2026-11-10): verify_jwt is FALSE in supabase/config.toml, matching the design above.
// It briefly shipped as true (6a11ea17); the live SPA happens to send a legacy anon JWT so
// uploads passed, but any key migration to an sb_publishable key would have 401'd every
// upload at the gateway and closed the only unlicensed booking path. apex-doctor drop-in
// 43 POSTs a nonexistent application_id here and goes CRITICAL on anything but 404.
// PDFs are accepted (emailed receipts are PDFs). The insert fires
// trg_licensing_proof_submitted (stamps applications.course_proof_submitted_at, raises one
// private alert); it never stamps course_purchased_at.
//
// CORS is inlined (not imported from ../_shared/cors.ts) so this deploys as a single
// self-contained file and the deployed source stays byte-identical to this repo file.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const err = (message: string, status = 500, code?: string) => json({ error: { message, code } }, status);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BYTES = 8 * 1024 * 1024; // 8 MB — a phone screenshot is well under this
const EXT: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg", "image/webp": "webp", "image/heic": "heic",
  "application/pdf": "pdf",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return err("POST only", 405);

  let body: { application_id?: string; data?: string; content_type?: string };
  try { body = await req.json(); } catch { return err("Invalid JSON", 400); }

  const applicationId = (body.application_id ?? "").trim();
  if (!UUID_RE.test(applicationId)) return err("A valid application is required.", 400, "bad_application");

  const contentType = (body.content_type ?? "").toLowerCase();
  if (!EXT[contentType]) return err("Upload a PNG, JPG, WEBP or HEIC image, or a PDF receipt.", 400, "bad_type");

  const b64 = (body.data ?? "").replace(/^data:[^,]+,/, "");
  if (!b64) return err("No file received.", 400, "empty");
  let bytes: Uint8Array;
  try { bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); }
  catch { return err("File could not be read.", 400, "decode"); }
  if (bytes.length === 0) return err("No file received.", 400, "empty");
  if (bytes.length > MAX_BYTES) return err("That file is too large (max 8 MB).", 400, "too_large");

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  // The application must actually exist — this is the whole gate for an anon write.
  const { data: app, error: appErr } = await supabase
    .from("applications").select("id").eq("id", applicationId).maybeSingle();
  if (appErr) return err("Could not verify the application.", 500, "app_lookup");
  if (!app) return err("We couldn't find that application.", 404, "no_application");

  const path = `${applicationId}/${Date.now()}.${EXT[contentType]}`;
  const up = await supabase.storage.from("licensing-proofs").upload(path, bytes, { contentType, upsert: false });
  if (up.error) return err(`Upload failed: ${up.error.message}`, 500, "upload");

  const { error: insErr } = await supabase.from("licensing_course_proofs").insert({
    application_id: applicationId, screenshot_path: path, file_size: bytes.length, content_type: contentType,
  });
  if (insErr) return err(`Could not record the submission: ${insErr.message}`, 500, "insert");

  return json({ ok: true, submitted_at: new Date().toISOString() });
});
