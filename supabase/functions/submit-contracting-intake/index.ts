// APEX contracting intake submission.
//
// The one public write path into public.contracting_intakes. It is public on
// purpose — Sam shares this link with producers who have no APEX login — so the
// controls that matter are in this file and in the RPC, not in a JWT check:
//
//   * exactly five accepted fields; every other key in the body is discarded
//     before the value reaches the database
//   * per-IP rate limiting
//   * a honeypot field that real humans never fill in
//   * all normalization, validation, dedupe and enqueue happen inside
//     submit_contracting_intake(), which is service-role only, so the shape of
//     the request cannot widen what actually gets written
//
// It answers with the intake id and the durable status. It never reports that
// an email, a Discord post, a workbook sync or an Ethos row happened — at this
// point none of them have. Those are enqueued and the dispatcher owns them.

// Pinned to 2.90.1 to match apex-outbox-dispatcher, which is verified alive in
// production. NOT a cosmetic version bump: this function shipped on 2.50.0 and
// returned WORKER_ERROR on every request — dead at boot, before the handler ran.
// esm.sh resolves transitive dependencies at request time, so pinning
// supabase-js pins nothing underneath it, and the 2.50.0 dependency graph
// currently fails to boot on this project. Probed live: submit-application
// (2.90.1) answers 400, applicant-checkin (2.50.0) returns the identical
// WORKER_ERROR. 41 functions in this repo are still on 2.50.0 — a wider
// pre-existing outage, tracked separately, not fixed by this release.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";
import { corsHeaders, jsonResponse, errorResponse } from "../_shared/cors.ts";
import {
  honeypotResponseBody,
  isHoneypotTripped,
  pickAcceptedFields,
  rateLimitVerdict,
} from "../_shared/intake-guard.ts";
import { parseSettingUrl } from "../_shared/contracting-delivery.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("POST only", 405, "METHOD_NOT_ALLOWED");
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return errorResponse("Server configuration missing", 503, "NOT_CONFIGURED");
  }

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return errorResponse("A JSON body is required", 400, "VALIDATION_ERROR");
  }
  if (!body || typeof body !== "object") {
    return errorResponse("A JSON body is required", 400, "VALIDATION_ERROR");
  }

  // Honeypot. Hidden in the form and never focusable, so anything in it came
  // from something automating the page.
  //
  // It must NOT answer `status: "accepted"`. Nothing was accepted — there is no
  // intake row, no id, and no queued work — and a client that believes the word
  // will show a producer a success screen and an AgentLink continuation for a
  // submission that does not exist. That is fake success aimed at ourselves. A
  // 202 with an explicit null id and no continuation is opaque to a bot (it
  // learns nothing from the status code) while remaining literally true.
  if (isHoneypotTripped(body)) {
    return jsonResponse(honeypotResponseBody(), 202);
  }

  const ip =
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";

  const { data: allowed, error: rateError } = await sb.rpc("check_rate_limit", {
    _bucket_key: `submit-contracting-intake:${ip}`,
    _max_requests: 8,
    _window_seconds: 300,
  });
  const verdict = rateLimitVerdict({ allowed, error: rateError });
  // FAIL CLOSED. This is an unauthenticated write endpoint, so the rate limiter
  // is the only thing standing between the open internet and unbounded inserts.
  // The shared _shared/rateLimit.ts helper logs and allows on error, which is a
  // defensible default for an authenticated endpoint and the wrong one here:
  // whatever broke the limiter is exactly when someone is hammering it, and
  // "allow everything while the brake is broken" is how a public form becomes a
  // spam sink. NPN dedupe does not save us either — an attacker picks a fresh
  // NPN per request. 503 is honest and retryable.
  if (verdict === "reject_unavailable") {
    console.error("[submit-contracting-intake] rate limiter unavailable:", rateError?.message);
    return errorResponse(
      "Submissions are temporarily unavailable. Try again shortly.",
      503,
      "RATE_LIMIT_UNAVAILABLE",
    );
  }
  if (verdict === "reject_rate_limited") {
    return errorResponse("Too many submissions. Try again in a few minutes.", 429, "RATE_LIMIT");
  }

  const payload = pickAcceptedFields(body);

  const { data, error } = await sb.rpc("submit_contracting_intake", {
    p_first_name: payload.first_name,
    p_last_name: payload.last_name,
    p_email: payload.email,
    p_phone: payload.phone,
    p_npn: payload.npn,
    p_source: "apex_contracting_page",
    p_submitted_by: null,
  });

  if (error) {
    console.error("[submit-contracting-intake] rpc failed:", error.message);
    return errorResponse("The submission could not be recorded. Try again.", 502, "INTAKE_FAILED");
  }

  const result = data as {
    ok: boolean;
    intake_id?: string;
    status?: string;
    review_reason?: string | null;
    replay?: boolean;
    error?: string;
    field?: string;
  };

  if (!result?.ok) {
    return errorResponse(result?.error ?? "validation_failed", 400, "VALIDATION_ERROR", {
      field: result?.field ?? null,
    });
  }

  // Only now — after a committed intake row — is the AgentLink continuation
  // handed back. Before durable acceptance there is nothing to continue from.
  let continueUrl: string | null = null;
  const { data: setting } = await sb
    .from("system_settings")
    .select("value")
    .eq("key", "agentlink_master_invite")
    .maybeSingle();
  // system_settings.value is TEXT and this key holds JSON text
  // ({"url": "...", "label": "..."}), so a bare typeof-string check would treat
  // the whole blob as the URL and yield nothing. parseSettingUrl handles both
  // live shapes and is covered by tests against the real stored value.
  continueUrl = parseSettingUrl(setting?.value as string | null);

  return jsonResponse({
    ok: true,
    intake_id: result.intake_id,
    status: result.status,
    review_reason: result.review_reason ?? null,
    replay: result.replay ?? false,
    continue_url: continueUrl,
    // Said plainly so no caller can mistake acceptance for delivery.
    delivery: "queued",
  });
});
