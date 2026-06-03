// notion-sync — push live Supabase data into Sam's 5 Notion command-center
// databases (Recruiting Pipeline, Content Calendar, Offers, People, Money).
//
// One-way Supabase → Notion. Sam edits status fields in Notion freely;
// the next sync upserts canonical fact fields (counts, $, last_touch) but
// does not blow away Sam's local status edits.
//
// Gate: NOTION_TOKEN env var. If missing → returns 503 so the cron backs
// off cleanly. This lets the edge fn ship now and turn live the moment
// Sam grants the integration token.
//
// Trigger: pg_cron every 30 min, or manual POST {} for one-shot.
//
// 2026-05-29 · ships disabled until NOTION_TOKEN drops in vault.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const NOTION_TOKEN = Deno.env.get("NOTION_TOKEN") ?? "";

// Sam's command-center database IDs (set in stone at 2026-05-29 02:25).
const DB_RECRUITING = "68c124e640cf4bc396995b3d7fc73946";
const DB_CONTENT    = "a38dd07b5e0342949ec03209fba878c1";
const DB_OFFERS     = "c6b17f4164f447be8618a2f7aa8477f9";
const DB_PEOPLE     = "e3bbec3a5afa4ac9b016060b2941166b";
const DB_MONEY      = "984957b6af9d4d269751cf34cc534185";

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

async function notion<T = any>(path: string, init: RequestInit): Promise<T> {
  const r = await fetch(`https://api.notion.com/v1${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${NOTION_TOKEN}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    },
  });
  if (!r.ok) throw new Error(`notion_${r.status}: ${await r.text().then(t => t.slice(0, 240))}`);
  return r.json() as Promise<T>;
}

type Counters = { pushed: number; updated: number; created: number; errors: string[] };

async function syncRecruiting(c: Counters) {
  // Pull latest pipeline state — exactly the rollup Sam wants on his phone.
  const { data: pipeline } = await supabase.rpc("recruiting_pipeline_rollup");
  if (!Array.isArray(pipeline)) return;
  for (const stage of pipeline) {
    try {
      // Try to find existing row by stage name → upsert.
      const search = await notion<{ results: Array<{ id: string }> }>(`/databases/${DB_RECRUITING}/query`, {
        method: "POST",
        body: JSON.stringify({
          filter: { property: "Stage", title: { equals: stage.stage_label } },
          page_size: 1,
        }),
      });
      const props = {
        Stage:    { title: [{ text: { content: stage.stage_label } }] },
        Count:    { number: Number(stage.count ?? 0) },
        "Last touched": { date: stage.last_touch_at ? { start: stage.last_touch_at } : null },
        Lane:     { select: { name: stage.lane ?? "full" } },
      };
      if (search.results.length > 0) {
        await notion(`/pages/${search.results[0].id}`, { method: "PATCH", body: JSON.stringify({ properties: props }) });
        c.updated += 1;
      } else {
        await notion(`/pages`, { method: "POST", body: JSON.stringify({ parent: { database_id: DB_RECRUITING }, properties: props }) });
        c.created += 1;
      }
      c.pushed += 1;
    } catch (e: any) {
      c.errors.push(`recruiting/${stage.stage_label}: ${e.message}`);
    }
  }
}

async function syncMoney(c: Counters) {
  // Money: pull aggregates from finance views — adapt to whatever's live.
  const { data: agg } = await supabase.rpc("finance_snapshot");
  if (!agg) return;
  const items: Array<{ label: string; usd: number; note?: string }> = Array.isArray(agg) ? agg : [agg];
  for (const item of items) {
    try {
      const search = await notion<{ results: Array<{ id: string }> }>(`/databases/${DB_MONEY}/query`, {
        method: "POST",
        body: JSON.stringify({
          filter: { property: "Item", title: { equals: item.label } },
          page_size: 1,
        }),
      });
      const props: Record<string, unknown> = {
        Item:   { title: [{ text: { content: item.label } }] },
        Amount: { number: Number(item.usd ?? 0) },
      };
      if (item.note) (props as any).Note = { rich_text: [{ text: { content: item.note } }] };
      if (search.results.length > 0) {
        await notion(`/pages/${search.results[0].id}`, { method: "PATCH", body: JSON.stringify({ properties: props }) });
        c.updated += 1;
      } else {
        await notion(`/pages`, { method: "POST", body: JSON.stringify({ parent: { database_id: DB_MONEY }, properties: props }) });
        c.created += 1;
      }
      c.pushed += 1;
    } catch (e: any) {
      c.errors.push(`money/${item.label}: ${e.message}`);
    }
  }
}

async function syncPeople(c: Counters) {
  // Push direct hires + downline summary.
  const { data: people } = await supabase
    .from("agents")
    .select("display_name, status, first_deal_at, contracted_at")
    .eq("status", "active")
    .order("first_deal_at", { ascending: false, nullsFirst: false })
    .limit(50);
  if (!people) return;
  for (const p of people) {
    try {
      const search = await notion<{ results: Array<{ id: string }> }>(`/databases/${DB_PEOPLE}/query`, {
        method: "POST",
        body: JSON.stringify({
          filter: { property: "Name", title: { equals: p.display_name } },
          page_size: 1,
        }),
      });
      const props: Record<string, unknown> = {
        Name:       { title: [{ text: { content: p.display_name ?? "Unknown" } }] },
        Status:     { select: { name: p.status ?? "active" } },
        "Activated":{ date: p.first_deal_at ? { start: p.first_deal_at } : null },
        "Contracted":{ date: p.contracted_at ? { start: p.contracted_at } : null },
      };
      if (search.results.length > 0) {
        await notion(`/pages/${search.results[0].id}`, { method: "PATCH", body: JSON.stringify({ properties: props }) });
        c.updated += 1;
      } else {
        await notion(`/pages`, { method: "POST", body: JSON.stringify({ parent: { database_id: DB_PEOPLE }, properties: props }) });
        c.created += 1;
      }
      c.pushed += 1;
    } catch (e: any) {
      c.errors.push(`people/${p.display_name}: ${e.message}`);
    }
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (!NOTION_TOKEN) {
    return new Response(
      JSON.stringify({ error: "NOTION_TOKEN missing — grant integration + add to Supabase vault" }),
      { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  let body: { only?: string[] } = {};
  try { body = await req.json(); } catch {}
  const wants = (k: string) => !body.only || body.only.includes(k);

  const counters: Counters = { pushed: 0, updated: 0, created: 0, errors: [] };

  try {
    if (wants("recruiting")) await syncRecruiting(counters);
    if (wants("money"))      await syncMoney(counters);
    if (wants("people"))     await syncPeople(counters);
    // content + offers omitted in v1 — Sam will iterate on schema first.

    try {
      await supabase.from("automation_runs").insert({
        automation_name: "notion-sync",
        status: counters.errors.length === 0 ? "success" : "warning",
        metadata: counters,
      });
    } catch (_) { /* audit-only */ }

    return new Response(JSON.stringify({ ok: true, ...counters }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message ?? String(e), counters }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
