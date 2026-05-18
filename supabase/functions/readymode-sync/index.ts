// readymode-sync
//
// Polls the ReadyMode dialer API for recent calls and upserts them into
// readymode_dialer_calls. Wired off by default (system_settings.
// readymode_sync_enabled='false') until Sam supplies API credentials.
//
// CONTRACT — system_settings keys:
//   readymode_api_base_url   e.g. "https://api.readymode.com"
//   readymode_api_key        bearer token
//   readymode_account_id     ReadyMode account/sub-account id
//   readymode_sync_enabled   "true" to actually fetch; otherwise this is a no-op
//
// IMPORTANT — the exact request shape depends on ReadyMode's specific API
// (their REST endpoints vary by product tier). The wire-up below assumes a
// `GET /v1/calls?account_id=X&since=Y` returning `{ data: [{...}] }`. If
// ReadyMode's API differs (it usually does), replace the buildRequest()
// and normalize() functions and the rest of the pipeline keeps working.
//
// Body: { since?: string }  — ISO timestamp. Defaults to last successful sync.
// Returns: { ok, pulled, inserted, updated, matched, error? }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

interface RawCall {
  id?: string;
  agent?: string;
  campaign?: string;
  phone?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  disposition?: string;
  disposition_at?: string;
  started_at?: string;
  ended_at?: string;
  duration_sec?: number;
  recording_url?: string;
  notes?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  // ── Start sync log row ────────────────────────────────────────────────
  const { data: logRow } = await sb
    .from("readymode_sync_log")
    .insert({ status: "running" })
    .select("id")
    .single();
  const logId = (logRow as any)?.id;

  async function finish(status: "ok" | "error", patch: Record<string, unknown>) {
    if (!logId) return;
    await sb.from("readymode_sync_log")
      .update({ status, finished_at: new Date().toISOString(), ...patch })
      .eq("id", logId);
  }

  try {
    // ── Pull config ────────────────────────────────────────────────────
    const { data: settings } = await sb
      .from("system_settings")
      .select("key, value")
      .in("key", [
        "readymode_api_base_url",
        "readymode_api_key",
        "readymode_account_id",
        "readymode_sync_enabled",
      ]);
    const cfg = Object.fromEntries(
      ((settings ?? []) as Array<{ key: string; value: string }>).map((r) => [r.key, r.value])
    );

    if (cfg.readymode_sync_enabled !== "true") {
      await finish("ok", { error_message: "sync disabled", pulled_count: 0 });
      return Response.json({ ok: true, skipped: true, reason: "sync disabled" }, { headers: corsHeaders });
    }
    if (!cfg.readymode_api_base_url || !cfg.readymode_api_key) {
      await finish("error", { error_message: "missing api credentials" });
      return Response.json({ ok: false, error: "missing api credentials" }, { status: 400, headers: corsHeaders });
    }

    // ── Determine since-window (default last 4h or override from body) ─
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const since = body.since ?? new Date(Date.now() - 4 * 3600_000).toISOString();

    // ── Build request — REPLACE THIS BLOCK once we have ReadyMode docs ─
    const url = new URL("/v1/calls", cfg.readymode_api_base_url);
    if (cfg.readymode_account_id) url.searchParams.set("account_id", cfg.readymode_account_id);
    url.searchParams.set("since", since);

    const res = await fetch(url.toString(), {
      headers: {
        "Authorization": `Bearer ${cfg.readymode_api_key}`,
        "Accept": "application/json",
      },
    });
    if (!res.ok) {
      const text = await res.text();
      await finish("error", { error_message: `ReadyMode HTTP ${res.status}: ${text.slice(0, 500)}` });
      return Response.json({ ok: false, error: `ReadyMode HTTP ${res.status}`, body: text.slice(0, 500) },
        { status: 502, headers: corsHeaders });
    }
    const json = await res.json().catch(() => ({}));
    const rawCalls: RawCall[] = json?.data ?? json?.calls ?? json ?? [];

    // ── Normalize each call into our row shape ─────────────────────────
    const rows = rawCalls.map((c) => ({
      external_call_id: c.id ?? null,
      agent_raw: c.agent ?? null,
      campaign_name: c.campaign ?? null,
      lead_phone: c.phone ?? null,
      lead_first_name: c.first_name ?? null,
      lead_last_name: c.last_name ?? null,
      lead_email: c.email ?? null,
      disposition: c.disposition ?? null,
      disposition_at: c.disposition_at ?? null,
      call_started_at: c.started_at ?? null,
      call_ended_at: c.ended_at ?? null,
      duration_seconds: typeof c.duration_sec === "number" ? c.duration_sec : null,
      recording_url: c.recording_url ?? null,
      notes: c.notes ?? null,
      raw: c as unknown as Record<string, unknown>,
    }));

    let inserted = 0;
    if (rows.length > 0) {
      // Upsert by external_call_id when present, else insert fresh
      const { error: e } = await sb
        .from("readymode_dialer_calls")
        .upsert(rows, { onConflict: "external_call_id", ignoreDuplicates: false });
      if (e) throw e;
      inserted = rows.length;
    }

    // ── Match to agents + leads ────────────────────────────────────────
    const { data: matchResult } = await sb.rpc("fn_match_readymode_calls" as any);
    const matched = (matchResult as any)?.matched_agents ?? 0;

    await finish("ok", { pulled_count: rawCalls.length, inserted_count: inserted, matched_count: matched });

    return Response.json({
      ok: true,
      pulled: rawCalls.length,
      inserted,
      matched,
    }, { headers: corsHeaders });
  } catch (err: any) {
    await finish("error", { error_message: String(err?.message ?? err).slice(0, 1000) });
    return Response.json({ ok: false, error: String(err?.message ?? err) },
      { status: 500, headers: corsHeaders });
  }
});
