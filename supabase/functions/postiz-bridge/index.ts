// postiz-bridge (MP-BRAND-ENGINE, 2026-11-12). Admin-only bridge between the approval queue and Postiz.
//
//   POST { "action": "status" }                    -> { configured }
//   POST { "action": "schedule", "draft_id": 123 } -> schedules that approved draft at its slot
//   POST { "action": "sync" }                      -> marks drafts shipped once Postiz reports a live URL
//
// Postiz needs two things that are not set yet, so today every call answers { configured: false } and
// the Social Media Center falls back to the manual path (approve, post by hand, paste the link):
//   1. Edge secret POSTIZ_API_KEY (and POSTIZ_API_URL when self-hosted).
//   2. system_settings.postiz_integrations = {"youtube":"<integration id>","tiktok-main":"...", ...}
// This function never reports a schedule it did not get a post id back for, and never marks a draft
// shipped without a release URL from Postiz. The Postiz calls below follow the public API
// (POST /posts, GET /posts) and have not run against a live Postiz account yet.
import { requireAuth, requireRole, AuthError } from "../_shared/auth.ts";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

const API = (Deno.env.get("POSTIZ_API_URL") ?? "https://api.postiz.com/public/v1").replace(/\/+$/, "");
const KEY = Deno.env.get("POSTIZ_API_KEY") ?? "";
const OWNER_UID = "71826bba-5577-4810-a226-1f6f2ad5288a";
/** Written on the draft while a schedule call is in flight, so two taps cannot both post. */
const PENDING = "pending";

interface Draft {
  id: number; draft_date: string | null; slot: string | null; platform: string | null; account: string | null;
  title: string | null; hook: string | null; caption: string | null; cta: string | null; status: string; postiz_post_id: string | null;
}

/** The draft's slot as a UTC instant. Arizona is UTC-7 all year. */
function slotInstant(d: Draft): string | null {
  if (!d.draft_date) return null;
  const hhmm = /^\d{2}:\d{2}$/.test(d.slot ?? "") ? d.slot! : "12:00";
  const t = new Date(`${d.draft_date}T${hhmm}:00-07:00`);
  return Number.isNaN(t.getTime()) ? null : t.toISOString();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "POST only" }, 405);
  try {
    const ctx = await requireAuth(req);
    await requireRole(ctx, "admin");
    // MP-302: the Social Media Center is the owner's. Holding the admin role is not enough.
    if (ctx.userId !== OWNER_UID) return jsonResponse({ error: "owner only" }, 403);
    const sb = ctx.serviceClient;

    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch { return jsonResponse({ error: "bad json" }, 400); }
    const action = String(body.action ?? "status");

    const map = await sb.from("system_settings").select("value").eq("key", "postiz_integrations").maybeSingle();
    let integrations: Record<string, string> = {};
    if (map.data?.value) {
      try { integrations = JSON.parse(map.data.value); } catch { integrations = {}; }
    }
    const configured = KEY !== "" && Object.keys(integrations).length > 0;
    if (action === "status" || !configured) {
      return jsonResponse({ configured, has_key: KEY !== "", accounts_mapped: Object.keys(integrations) });
    }

    if (action === "schedule") {
      const id = Number(body.draft_id);
      if (!Number.isInteger(id)) return jsonResponse({ error: "draft_id required" }, 400);
      const got = await sb.from("social_bot_drafts")
        .select("id,draft_date,slot,platform,account,title,hook,caption,cta,status,postiz_post_id").eq("id", id).maybeSingle();
      if (got.error || !got.data) return jsonResponse({ error: "draft not found" }, 404);
      const d = got.data as Draft;
      if (d.status !== "approved") return jsonResponse({ error: "only an approved draft can be scheduled" }, 409);
      if (d.postiz_post_id === PENDING) return jsonResponse({ configured, scheduled: false, reason: "a schedule request for this draft is already in flight" });
      if (d.postiz_post_id) return jsonResponse({ configured, scheduled: true, already: true, postiz_post_id: d.postiz_post_id });
      const integration = integrations[d.account ?? ""];
      if (!integration) return jsonResponse({ configured, scheduled: false, reason: `no Postiz channel mapped for ${d.account ?? "this draft"}` });
      const when = slotInstant(d);
      if (!when) return jsonResponse({ configured, scheduled: false, reason: "the draft has no date" });
      const content = [d.caption || d.hook || d.title || "", d.cta ? `DM "${d.cta}"` : ""].filter(Boolean).join("\n\n");
      // Claim the draft before calling Postiz. The filter on a null id makes the claim atomic:
      // of two simultaneous requests, one updates the row and the other updates nothing.
      const claim = await sb.from("social_bot_drafts").update({ postiz_post_id: PENDING }).eq("id", id).eq("status", "approved").is("postiz_post_id", null).select("id");
      if (claim.error) return jsonResponse({ configured, scheduled: false, reason: `could not claim the draft: ${claim.error.message}` });
      if ((claim.data?.length ?? 0) !== 1) return jsonResponse({ configured, scheduled: false, reason: "another request is already scheduling this draft" });
      const release = async () => {
        const back = await sb.from("social_bot_drafts").update({ postiz_post_id: null }).eq("id", id).eq("postiz_post_id", PENDING);
        if (back.error) console.error("postiz-bridge: could not release the claim on draft", id, back.error.message);
      };
      const r = await fetch(`${API}/posts`, {
        method: "POST",
        headers: { Authorization: KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ type: "schedule", date: when, shortLink: false, tags: [], posts: [{ integration: { id: integration }, value: [{ content }], settings: {} }] }),
      });
      const text = await r.text();
      if (!r.ok) { await release(); return jsonResponse({ configured, scheduled: false, reason: `Postiz answered ${r.status}`, detail: text.slice(0, 300) }); }
      let postId = "";
      try {
        const parsed = JSON.parse(text);
        const first = Array.isArray(parsed) ? parsed[0] : parsed;
        postId = String(first?.postId ?? first?.id ?? "");
      } catch { postId = ""; }
      if (!postId) { await release(); return jsonResponse({ configured, scheduled: false, reason: "Postiz returned no post id", detail: text.slice(0, 300) }); }
      const saved = await sb.from("social_bot_drafts").update({ postiz_post_id: postId, ship_source: "postiz" }).eq("id", id).select("id");
      if (saved.error || (saved.data?.length ?? 0) !== 1) return jsonResponse({ configured, scheduled: true, postiz_post_id: postId, warning: "scheduled in Postiz, but the post id was not saved on the draft" });
      return jsonResponse({ configured, scheduled: true, postiz_post_id: postId, at: when });
    }

    if (action === "sync") {
      const open = await sb.from("social_bot_drafts").select("id,postiz_post_id").eq("status", "approved").not("postiz_post_id", "is", null).neq("postiz_post_id", PENDING);
      if (open.error) return jsonResponse({ error: open.error.message }, 500);
      const rows = open.data ?? [];
      if (!rows.length) return jsonResponse({ configured, checked: 0, shipped: 0 });
      const from = new Date(Date.now() - 21 * 86_400_000).toISOString();
      const to = new Date(Date.now() + 86_400_000).toISOString();
      const r = await fetch(`${API}/posts?startDate=${encodeURIComponent(from)}&endDate=${encodeURIComponent(to)}`, { headers: { Authorization: KEY } });
      if (!r.ok) return jsonResponse({ configured, checked: rows.length, shipped: 0, reason: `Postiz answered ${r.status}` });
      const payload = await r.json();
      const posts: { id?: string; releaseURL?: string | null; publishDate?: string }[] = Array.isArray(payload) ? payload : (payload?.posts ?? []);
      let shipped = 0;
      for (const row of rows) {
        const p = posts.find((x) => String(x.id) === row.postiz_post_id);
        if (!p?.releaseURL) continue;
        const u = await sb.from("social_bot_drafts")
          .update({ status: "shipped", shipped_url: p.releaseURL, shipped_at: p.publishDate ?? new Date().toISOString(), ship_source: "postiz" })
          .eq("id", row.id).eq("status", "approved").select("id");
        if (!u.error && (u.data?.length ?? 0) === 1) shipped++;
      }
      return jsonResponse({ configured, checked: rows.length, shipped });
    }

    return jsonResponse({ error: "unknown action" }, 400);
  } catch (e) {
    if (e instanceof AuthError) return jsonResponse({ error: e.message }, e.status);
    return jsonResponse({ error: (e as Error)?.message ?? String(e) }, 500);
  }
});
