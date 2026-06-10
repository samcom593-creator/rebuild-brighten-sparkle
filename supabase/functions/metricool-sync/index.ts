// metricool-sync — 2026-06-10
// Pulls Sam's brand profile from Metricool + writes social_snapshots rows.
//
// Sam: "Build out a link with Metricool. I'll put in the API so it tracks
// the metrics."
//
// Auth: METRICOOL_TOKEN secret on Supabase.
//
// What this does today (until detailed analytics endpoints are mapped):
//   1. GET /admin/simpleProfiles returns the connected handles
//   2. For each platform, create a social_snapshots row with handle +
//      source='metricool' so the SocialDashboard knows they're auto-tracked
//   3. Future: GET /v2/analytics/timelines/{network} adds follower counts +
//      engagement once we figure out the exact param schema (currently 500)
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
  twitter?: string | null;
  threads?: string | null;
  linkedinCompany?: string | null;
  picture?: string | null;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  if (!METRICOOL_TOKEN) {
    return Response.json({ error: "METRICOOL_TOKEN secret not set" }, { status: 500, headers: cors });
  }

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  try {
    const r = await fetch("https://app.metricool.com/api/admin/simpleProfiles", {
      headers: { "X-Mc-Auth": METRICOOL_TOKEN, Accept: "application/json" },
    });
    if (!r.ok) throw new Error(`Metricool simpleProfiles ${r.status}`);
    const brands: MetricoolBrand[] = await r.json();
    if (brands.length === 0) {
      return Response.json({ error: "No brands on this Metricool account" }, { status: 200, headers: cors });
    }
    const brand = brands[0];

    // Track which platforms are connected. Each becomes a social_snapshots
    // row that tells the SocialDashboard "this platform is auto-tracked
    // via Metricool" + holds the handle so the UI can render correctly.
    const platforms = [
      { key: "instagram", handle: brand.instagram },
      { key: "youtube", handle: brand.youtube },
      { key: "tiktok", handle: brand.tiktok },
    ].filter((p): p is { key: string; handle: string } => Boolean(p.handle));

    let inserted = 0;
    for (const p of platforms) {
      const { error } = await sb.from("social_snapshots").insert({
        platform: p.key,
        handle: p.handle,
        source: "imported",
        payload: {
          metricool_brand_id: brand.id,
          metricool_user_id: brand.userId,
          metricool_picture: brand.picture,
          last_metricool_sync: new Date().toISOString(),
        },
      });
      if (!error) inserted++;
    }

    return Response.json(
      {
        ok: true,
        brand_id: brand.id,
        brand_label: brand.label,
        platforms_synced: platforms.map((p) => `${p.key}:@${p.handle}`),
        snapshots_inserted: inserted,
      },
      { status: 200, headers: cors },
    );
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500, headers: cors },
    );
  }
};

serve(handler);
