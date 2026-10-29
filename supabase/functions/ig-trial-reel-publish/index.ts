// ig-trial-reel-publish — MP-311 (2026-10-28). Drains public.ig_trial_reel_queue onto
// @sell4daddy as Instagram TRIAL REELS (shown to non-followers first; Instagram shares
// the reel to followers only if it performs: graduation_strategy SS_PERFORMANCE).
// Sam: "use my main page, just make them trials". Never posts a non-trial reel.
//
// pg_cron apex-ig-trial-reels (4,24,44 * * * *). Auth: Bearer APEX_BOT_TOKEN.
// Each run: (1) advance any open container (IN_PROGRESS -> FINISHED -> media_publish),
// (2) if pacing allows, open ONE new container from the oldest pending row.
// Pacing: system_settings ig_trial_reels_per_day (default 2) per rolling 24h and
// ig_trial_reels_min_gap_hours (default 5). A Graph failure is never a 200: the row
// carries the error and the response is 502 so the edge-call ledger grades it red.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const GRAPH = "https://graph.instagram.com/v23.0";
const BUCKET = "ig-trial-reels";
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  const expected = Deno.env.get("APEX_BOT_TOKEN") ?? "";
  if (!expected || (req.headers.get("authorization") ?? "") !== `Bearer ${expected}`) return json({ ok: false, error: "unauthorized" }, 401);
  const sb = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false } });
  const dry = new URL(req.url).searchParams.get("dry_run") === "1";

  const { data: st } = await sb.from("system_settings").select("key,value")
    .in("key", ["meta_instagram_token", "meta_instagram_page_id", "ig_trial_reels_per_day", "ig_trial_reels_min_gap_hours"]);
  const cfg = Object.fromEntries((st ?? []).map((r) => [r.key, String(r.value ?? "").trim().replace(/^"|"$/g, "")]));
  const token = cfg.meta_instagram_token ?? "";
  if (!token) return json({ ok: false, error: "no_token" }, 503);
  const perDay = Math.max(0, Number(cfg.ig_trial_reels_per_day ?? 2) || 0);
  const gapH = Math.max(0, Number(cfg.ig_trial_reels_min_gap_hours ?? 5) || 0);

  const gget = async (path: string) => (await fetch(`${GRAPH}/${path}${path.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(token)}`)).json();
  const gpost = async (path: string, body: Record<string, unknown>) =>
    (await fetch(`${GRAPH}/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, access_token: token }) })).json();
  const errText = (j: any) => j?.error ? `${j.error.code ?? ""}/${j.error.error_subcode ?? ""} ${j.error.message ?? JSON.stringify(j.error)}`.slice(0, 500) : null;

  let igId = cfg.meta_instagram_page_id ?? "";
  if (!igId) { const me = await gget("me?fields=user_id"); igId = String(me?.user_id ?? ""); }
  if (!igId) return json({ ok: false, error: "no_ig_user_id" }, 503);

  const receipts: Array<Record<string, unknown>> = [];
  let failed = 0;

  // (1) advance open containers
  const { data: open } = await sb.from("ig_trial_reel_queue").select("*").eq("status", "container").order("container_at");
  for (const row of open ?? []) {
    const s = await gget(`${row.container_id}?fields=status_code,status`);
    const code = String(s?.status_code ?? "");
    if (code === "FINISHED") {
      if (dry) { receipts.push({ id: row.id, would: "publish" }); continue; }
      const p = await gpost(`${igId}/media_publish`, { creation_id: row.container_id });
      const e = errText(p);
      if (e || !p?.id) {
        // Codes 1/2/4/9007 are Meta's "retry later" family (seen live 2026-10-28: code 2 on a
        // FINISHED container). Keep the container open and retry next tick; the 2h stuck rule
        // below is the backstop. Anything else is permanent.
        const transient = [1, 2, 4, 9007, 9004].includes(Number(p?.error?.code)) || p?.error?.is_transient === true;
        if (!transient) failed++;
        await sb.from("ig_trial_reel_queue").update(transient
          ? { error: `media_publish (will retry): ${e}` }
          : { status: "failed", error: `media_publish: ${e ?? JSON.stringify(p).slice(0, 300)}` }).eq("id", row.id);
        receipts.push({ id: row.id, publish_error: e, retry: transient });
        if (transient) receipts.push({ id: row.id, waiting: "PUBLISH_RETRY" });
        continue;
      }
      const m = await gget(`${p.id}?fields=permalink`);
      await sb.from("ig_trial_reel_queue").update({ status: "published", media_id: String(p.id), permalink: m?.permalink ?? null, published_at: new Date().toISOString(), error: null }).eq("id", row.id);
      await sb.storage.from(BUCKET).remove([row.storage_path]); // Meta has its copy; keep the bucket small
      receipts.push({ id: row.id, published: p.id, permalink: m?.permalink ?? null });
    } else if (code === "ERROR" || code === "EXPIRED" || errText(s) ||
               (Date.now() - new Date(row.container_at).getTime()) > 2 * 3600_000) {
      failed++;
      await sb.from("ig_trial_reel_queue").update({ status: "failed", error: `container ${code || "lookup"}: ${s?.status ?? errText(s) ?? "stuck >2h"}`.slice(0, 500) }).eq("id", row.id);
      receipts.push({ id: row.id, container_failed: code, status: s?.status ?? errText(s) });
    } else {
      receipts.push({ id: row.id, waiting: code || "IN_PROGRESS" });
    }
  }

  // (2) pacing, then open ONE new container
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { count: day } = await sb.from("ig_trial_reel_queue").select("id", { count: "exact", head: true }).eq("status", "published").gte("published_at", since);
  const { data: last } = await sb.from("ig_trial_reel_queue").select("published_at").eq("status", "published").order("published_at", { ascending: false }).limit(1);
  const lastAt = last?.[0]?.published_at ? new Date(last[0].published_at).getTime() : 0;
  const stillOpen = (open ?? []).length > 0 && receipts.some((r) => "waiting" in r);
  const paced = (day ?? 0) >= perDay ? "daily_cap" : (Date.now() - lastAt) < gapH * 3600_000 ? "min_gap" : stillOpen ? "container_open" : null;

  if (!paced) {
    const { data: next } = await sb.from("ig_trial_reel_queue").select("*").eq("status", "pending").order("created_at").limit(1);
    const row = next?.[0];
    if (row && dry) receipts.push({ id: row.id, would: "create_container" });
    else if (row) {
      const c = await gpost(`${igId}/media`, {
        media_type: "REELS",
        video_url: row.video_url,
        caption: row.caption ?? "",
        trial_params: { graduation_strategy: "SS_PERFORMANCE" },
      });
      const e = errText(c);
      if (e || !c?.id) {
        failed++;
        const attempts = (row.attempts ?? 0) + 1;
        await sb.from("ig_trial_reel_queue").update({ attempts, status: attempts >= 3 ? "failed" : "pending", error: `media create: ${e ?? JSON.stringify(c).slice(0, 300)}` }).eq("id", row.id);
        receipts.push({ id: row.id, create_error: e, attempts });
      } else {
        await sb.from("ig_trial_reel_queue").update({ status: "container", container_id: String(c.id), container_at: new Date().toISOString(), attempts: (row.attempts ?? 0) + 1, error: null }).eq("id", row.id);
        receipts.push({ id: row.id, container: c.id });
      }
    }
  }

  const { count: pending } = await sb.from("ig_trial_reel_queue").select("id", { count: "exact", head: true }).eq("status", "pending");
  return json({ ok: failed === 0, paced, published_24h: day ?? 0, pending: pending ?? 0, receipts }, failed ? 502 : 200);
});
