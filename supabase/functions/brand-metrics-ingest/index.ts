// brand-metrics-ingest (MP-BRAND-ENGINE, 2026-11-12).
// Bots and iOS Shortcuts POST one reading at a time:
//   { "account": "tiktok-main", "metric": "views", "value": 1240, "metric_date": "2026-11-12" }
// with the shared key in an `x-brand-key` header. The key lives in system_settings.brand_ingest_key
// (admin-readable only) and is compared server-side; this function never returns it.
// verify_jwt=false because a Shortcut has no Supabase session; the key is the credential.
// Same day + account + metric again replaces that reading (upsert on the table's unique key).
const SB = Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const ACCOUNTS = new Set(["youtube", "tiktok-main", "tiktok-sales", "tiktok-rant", "snapchat", "instagram"]);
const METRIC_RE = /^[a-z][a-z0-9_]{1,39}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type, x-brand-key",
  "access-control-allow-methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "content-type": "application/json" } });

const svc = { apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json" };

/** Constant-time string compare, so the key cannot be guessed one character at a time. */
function sameKey(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function phoenixToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Phoenix", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const given = (req.headers.get("x-brand-key") ?? "").trim();
  if (!given) return json({ error: "missing x-brand-key" }, 401);

  const k = await fetch(SB + "/rest/v1/system_settings?key=eq.brand_ingest_key&select=value", { headers: svc });
  if (!k.ok) return json({ error: "key lookup failed", status: k.status }, 503);
  const rows = (await k.json()) as { value: string }[];
  const expected = rows[0]?.value ?? "";
  if (!expected || !sameKey(given, expected)) return json({ error: "wrong key" }, 401);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }

  const account = String(body.account ?? "").trim().toLowerCase();
  const metric = String(body.metric ?? "").trim().toLowerCase();
  const value = Number(body.value);
  const metric_date = String(body.metric_date ?? "").trim() || phoenixToday();
  const source = String(body.source ?? "ingest").slice(0, 40) || "ingest";

  if (!ACCOUNTS.has(account)) return json({ error: "unknown account", allowed: [...ACCOUNTS] }, 400);
  if (!METRIC_RE.test(metric)) return json({ error: "metric must be lowercase letters, digits or _" }, 400);
  if (body.value == null || body.value === "" || !Number.isFinite(value) || value < 0) return json({ error: "value must be a number, 0 or more" }, 400);
  if (!DATE_RE.test(metric_date) || Number.isNaN(Date.parse(metric_date + "T00:00:00Z"))) return json({ error: "metric_date must be YYYY-MM-DD" }, 400);
  if (metric_date > phoenixToday()) return json({ error: "metric_date is in the future" }, 400);

  const up = await fetch(SB + "/rest/v1/brand_metrics_daily?on_conflict=metric_date,account,metric", {
    method: "POST",
    headers: { ...svc, Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({ metric_date, account, metric, value, source, updated_at: new Date().toISOString() }),
  });
  if (!up.ok) return json({ error: "not saved", status: up.status, detail: (await up.text()).slice(0, 300) }, 502);
  const saved = (await up.json()) as unknown[];
  if (!Array.isArray(saved) || saved.length !== 1) return json({ error: "not saved: the write returned no row" }, 502);
  return json({ ok: true, saved: saved[0] });
});
