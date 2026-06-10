// metricool-sync — 2026-06-10 v2 (with real analytics)
//
// Sam: "Make sure we're actually using Metricool seamlessly with the
// analytics. I should be able to pull those reports perfectly now."
//
// Auth: METRICOOL_TOKEN secret on Supabase.
//
// Pipeline:
//   1. GET /admin/simpleProfiles → brand + connected handles
//   2. For each platform with a handle, GET /v2/analytics/posts/{network}
//      with from/to as ISO datetime (T00:00:00 format — discovered 2026-06-10)
//   3. Roll the per-post data into a 30-day brand snapshot:
//      - total posts, total reach, total engagement, top post
//   4. Insert into social_snapshots
//
// What previously failed:
//   - start/end params  → 500 "Required request parameter 'from' for method"
//   - from/to as YYYYMMDD or YYYY-MM-DD → 400 "Validation failure"
//   - Working format: from/to as YYYY-MM-DDTHH:MM:SS (ISO datetime)
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const METRICOOL_TOKEN = Deno.env.get("METRICOOL_TOKEN") ?? "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface MetricoolBrand {
  id: number;
  userId: number;
  label: string;
  instagram?: string | null;
  youtube?: string | null;
  tiktok?: string | null;
  facebook?: string | null;
}

interface MetricoolPost {
  postId?: string;
  publishedAt?: { dateTime?: string; timezone?: string };
  metrics?: Record<string, number | null>;
  reach?: number | null;
  impressions?: number | null;
  likes?: number | null;
  comments?: number | null;
  shares?: number | null;
  saved?: number | null;
  views?: number | null;
  engagementRate?: number | null;
  permalink?: string | null;
  caption?: string | null;
}

function sumMetric(posts: MetricoolPost[], key: keyof MetricoolPost): number {
  let s = 0;
  for (const p of posts) {
    const v = p[key];
    if (typeof v === "number") s += v;
    // Some metrics nest inside p.metrics
    if (p.metrics && typeof p.metrics[key as string] === "number") {
      s += p.metrics[key as string] as number;
    }
  }
  return s;
}

async function pullPosts(token: string, blogId: number, userId: number, network: string, fromIso: string, toIso: string): Promise<MetricoolPost[]> {
  const url = `https://app.metricool.com/api/v2/analytics/posts/${network}?blogId=${blogId}&userId=${userId}&from=${fromIso}&to=${toIso}&timezone=America/Phoenix`;
  const r = await fetch(url, { headers: { "X-Mc-Auth": token, Accept: "application/json" } });
  if (!r.ok) return [];
  const obj = await r.json();
  return Array.isArray(obj?.data) ? obj.data : [];
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  if (!METRICOOL_TOKEN) {
    return Response.json({ error: "METRICOOL_TOKEN secret not set" }, { status: 500, headers: cors });
  }

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  try {
    // 1. Brand profile
    const r = await fetch("https://app.metricool.com/api/admin/simpleProfiles", {
      headers: { "X-Mc-Auth": METRICOOL_TOKEN, Accept: "application/json" },
    });
    if (!r.ok) throw new Error(`Metricool simpleProfiles ${r.status}`);
    const brands: MetricoolBrand[] = await r.json();
    if (brands.length === 0) return Response.json({ error: "No brands" }, { status: 200, headers: cors });
    const brand = brands[0];

    // 2. 30-day window in Phoenix TZ
    const now = new Date();
    const fromIso = new Date(now.getTime() - 30 * 86400000).toISOString().slice(0, 19);
    const toIso = now.toISOString().slice(0, 19);

    // 3. Pull posts for each connected platform
    const platforms = [
      { key: "instagram", net: "instagram", handle: brand.instagram },
      { key: "tiktok", net: "tiktok", handle: brand.tiktok },
      { key: "youtube", net: "youtube", handle: brand.youtube },
    ].filter((p): p is { key: string; net: string; handle: string } => Boolean(p.handle));

    const results: Array<Record<string, unknown>> = [];

    for (const p of platforms) {
      const posts = await pullPosts(METRICOOL_TOKEN, brand.id, brand.userId, p.net, fromIso, toIso);

      const total_posts = posts.length;
      const total_reach = sumMetric(posts, "reach") || sumMetric(posts, "impressions");
      const total_likes = sumMetric(posts, "likes");
      const total_comments = sumMetric(posts, "comments");
      const total_shares = sumMetric(posts, "shares");
      const total_saves = sumMetric(posts, "saved");
      const total_views = sumMetric(posts, "views");
      const engagement_total = total_likes + total_comments + total_shares + total_saves;
      const engagement_rate = total_reach > 0 ? Math.round((engagement_total / total_reach) * 10000) / 100 : null;

      // Top post by reach (or views for tiktok/youtube)
      const top = [...posts].sort((a, b) => {
        const aReach = Number(a.reach ?? a.views ?? a.impressions ?? 0);
        const bReach = Number(b.reach ?? b.views ?? b.impressions ?? 0);
        return bReach - aReach;
      })[0];

      const payload = {
        metricool_brand_id: brand.id,
        metricool_user_id: brand.userId,
        window_days: 30,
        from: fromIso,
        to: toIso,
        total_posts,
        total_reach,
        total_views,
        total_likes,
        total_comments,
        total_shares,
        total_saves,
        engagement_total,
        top_post: top ? {
          postId: top.postId,
          published_at: top.publishedAt?.dateTime,
          reach: top.reach ?? top.views ?? top.impressions,
          likes: top.likes,
          comments: top.comments,
          permalink: top.permalink,
        } : null,
      };

      const { error } = await sb.from("social_snapshots").insert({
        platform: p.key,
        handle: p.handle,
        source: "auto",
        posts_total: total_posts,
        reach_7d: total_reach,
        views_7d: total_views,
        engagement_rate,
        payload,
      });
      if (!error) results.push({ platform: p.key, ...payload });
    }

    return Response.json({ ok: true, brand: brand.label, results }, { status: 200, headers: cors });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Unknown" }, { status: 500, headers: cors });
  }
};

serve(handler);
