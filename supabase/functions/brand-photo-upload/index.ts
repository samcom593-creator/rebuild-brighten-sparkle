// King of Sales photo upload — passcode-gated, no user login required.
// The phone sends the raw image bytes with the shared edit code in a header;
// this function checks the code, validates the slot + type + size, and writes
// to the public "brand" storage bucket using the service role. That removes the
// whole email-OTP / auth-session dance that was flaky on iOS Safari.
const SB = Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CODE = Deno.env.get("BRAND_EDIT_CODE") || "";
// Every slot the site declares ([data-slot] keys across index/rentals/fitness/mentorship/ai).
const ALLOW = new Set([
  "hub-hero", "pane-ins", "pane-cars", "pane-ment", "pane-fit", "pane-ai",
  "rental-hero", "car-1", "car-2", "car-3", "car-4", "car-5", "car-6",
  "fitness-hero", "fitness-t1", "fitness-t2", "fitness-t3", "fitness-t4",
  "mentorship-hero", "ai-hero", "transform-1", "transform-2", "transform-3", "transform-4",
]);
const MAX = 15 * 1024 * 1024;

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "x-edit-code, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "content-type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!CODE) return json({ error: "editor not configured" }, 503);

  const code = req.headers.get("x-edit-code") || "";
  // constant-ish time compare + a small delay so a wrong code can't be brute-forced fast
  if (code.length !== CODE.length || code !== CODE) {
    await new Promise((r) => setTimeout(r, 700));
    return json({ error: "Wrong code." }, 401);
  }

  const slot = new URL(req.url).searchParams.get("slot") || "";
  // Fleet slots are open-ended (car-1 … car-99) so the whole rental fleet can be filled.
  if (!ALLOW.has(slot) && !/^car-\d{1,2}$/.test(slot)) return json({ error: "unknown photo slot" }, 400);

  const ct = (req.headers.get("content-type") || "").split(";")[0].trim();
  if (!/^image\/(jpeg|png|webp)$/.test(ct)) return json({ error: "Use a JPG, PNG or WebP." }, 400);

  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.length === 0) return json({ error: "empty file" }, 400);
  if (bytes.length > MAX) return json({ error: "That photo is over 15MB — pick a smaller one." }, 413);

  const up = await fetch(`${SB}/storage/v1/object/brand/${slot}`, {
    method: "POST",
    headers: { authorization: `Bearer ${KEY}`, apikey: KEY, "content-type": ct, "x-upsert": "true", "cache-control": "60" },
    body: bytes,
  });
  if (!up.ok) return json({ error: "Upload failed, try again.", detail: (await up.text()).slice(0, 200) }, 502);

  return json({ ok: true, url: `${SB}/storage/v1/object/public/brand/${slot}?v=${Date.now()}` });
});
