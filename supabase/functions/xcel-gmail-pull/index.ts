// xcel-gmail-pull — daily Gmail puller for Xcel Solutions exports.
//
// Workflow:
//   1. Search Gmail for messages labeled "Apex/XCEL" newer than 36h
//      (overlap = idempotent — xcel-import dedupes by email + stage).
//   2. For each message with a .csv attachment, fetch the bytes,
//      decode base64url to UTF-8, then POST to /xcel-import.
//   3. Apply the "Apex/XCEL-Processed" label so the same CSV doesn't
//      get pulled twice; mark unread → read.
//
// Why: Sam was manually exporting + posting Xcel CSV. 39 applicants
// were frozen at "course_purchased" because the manual step lagged.
// This fn drains the lag down to 5 min by running on cron.
//
// Auth: GOOGLE_REFRESH_TOKEN from system_settings.gmail_xcel_oauth
//       (refresh_token, client_id, client_secret). Returns 503 if
//       creds missing so cron can back off cleanly.
//
// PL-091 · 2026-05-29

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const XCEL_LABEL_NAME = "Apex/XCEL";
const XCEL_DONE_LABEL = "Apex/XCEL-Processed";

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

type OauthCreds = {
  client_id: string;
  client_secret: string;
  refresh_token: string;
};

async function loadCreds(): Promise<OauthCreds | null> {
  const { data } = await supabase
    .from("system_settings")
    .select("value")
    .eq("key", "gmail_xcel_oauth")
    .maybeSingle();
  const value = (data?.value ?? null) as OauthCreds | null;
  if (!value?.client_id || !value?.client_secret || !value?.refresh_token) return null;
  return value;
}

async function exchangeForAccessToken(c: OauthCreds): Promise<string> {
  const body = new URLSearchParams({
    client_id: c.client_id,
    client_secret: c.client_secret,
    refresh_token: c.refresh_token,
    grant_type: "refresh_token",
  });
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!r.ok) throw new Error(`oauth_${r.status}: ${await r.text()}`);
  const j = await r.json() as { access_token: string };
  return j.access_token;
}

async function gmail<T = any>(path: string, token: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  if (!r.ok) throw new Error(`gmail_${r.status}: ${await r.text()}`);
  return r.json() as Promise<T>;
}

function b64UrlDecode(s: string): Uint8Array {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const normalized = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(normalized);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const creds = await loadCreds();
  if (!creds) {
    return new Response(
      JSON.stringify({ error: "gmail_oauth_missing", hint: "set system_settings.gmail_xcel_oauth = {client_id, client_secret, refresh_token}" }),
      { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    const token = await exchangeForAccessToken(creds);

    // Resolve label IDs.
    const labelsResp = await gmail<{ labels: Array<{ id: string; name: string }> }>("/labels", token);
    const inLabel = labelsResp.labels.find((l) => l.name === XCEL_LABEL_NAME);
    if (!inLabel) {
      return new Response(JSON.stringify({ error: `label_not_found:${XCEL_LABEL_NAME}` }), {
        status: 412, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    let doneLabel = labelsResp.labels.find((l) => l.name === XCEL_DONE_LABEL);
    if (!doneLabel) {
      doneLabel = await gmail<{ id: string; name: string }>("/labels", token, {
        method: "POST",
        body: JSON.stringify({ name: XCEL_DONE_LABEL, labelListVisibility: "labelShow", messageListVisibility: "show" }),
      });
    }

    // Pull last 36h of unprocessed messages.
    const query = `label:${XCEL_LABEL_NAME} -label:${XCEL_DONE_LABEL} newer_than:2d has:attachment filename:csv`;
    const list = await gmail<{ messages?: Array<{ id: string }> }>(`/messages?q=${encodeURIComponent(query)}`, token);
    const ids = (list.messages ?? []).map((m) => m.id);
    const summary = { found: ids.length, processed: 0, imported_rows_total: 0, errors: [] as string[] };

    for (const id of ids) {
      try {
        const msg = await gmail<any>(`/messages/${id}`, token);
        const parts: any[] = [];
        const walk = (p: any) => {
          if (!p) return;
          if (Array.isArray(p.parts)) p.parts.forEach(walk);
          parts.push(p);
        };
        walk(msg.payload);

        const csvPart = parts.find((p) =>
          (p.filename ?? "").toLowerCase().endsWith(".csv") &&
          p.body?.attachmentId
        );
        if (!csvPart) {
          summary.errors.push(`msg ${id}: no csv attachment`);
          continue;
        }

        const att = await gmail<{ data: string }>(`/messages/${id}/attachments/${csvPart.body.attachmentId}`, token);
        const bytes = b64UrlDecode(att.data);
        const text = new TextDecoder("utf-8").decode(bytes);

        const importResp = await fetch(`${SUPABASE_URL}/functions/v1/xcel-import`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${SERVICE_KEY}`,
            "Content-Type": "text/csv",
          },
          body: text,
        });
        if (!importResp.ok) {
          summary.errors.push(`msg ${id}: xcel-import ${importResp.status}: ${(await importResp.text()).slice(0, 240)}`);
          continue;
        }
        const importJson = await importResp.json().catch(() => ({} as any));
        summary.imported_rows_total += Number(importJson?.updated ?? importJson?.matched ?? 0);

        // Tag processed so we don't double-pull.
        await gmail(`/messages/${id}/modify`, token, {
          method: "POST",
          body: JSON.stringify({ addLabelIds: [doneLabel!.id], removeLabelIds: ["UNREAD"] }),
        });
        summary.processed += 1;
      } catch (err: any) {
        summary.errors.push(`msg ${id}: ${err?.message ?? "unknown"}`);
      }
    }

    return new Response(JSON.stringify(summary), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message ?? "unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
