// Credential gate for the send-* wrappers that take a recipient off the
// REQUEST BODY.
//
// send-email and send-bulk-email both forward body.to / body.recipients[]
// straight into _shared/email.ts#sendEmail, which sends from Sam's verified
// Resend domain. Anything that reaches those handlers can therefore mail any
// address on earth as Apex. Until MP-446 neither read a credential at all:
// a bare POST with no Authorization header reached the handler (proven by the
// 400 it returned from its own body validation, not by sending mail).
//
// The gateway cannot be the gate. config.toml sets verify_jwt = false on
// these, and flipping it to true would not close the hole anyway: MP-443
// measured that the gateway ACCEPTS the public anon key, which ships inside
// the browser bundle. So the check has to live in the function, and it has to
// reject the anon key explicitly.
//
// Accepts exactly the two callers that exist today, and nothing else:
//   1. the service role key   -- pg_net triggers (reapply_doors_open,
//      hiring_pipeline_v2, apex_automation_v10) and function-to-function
//      calls (siri-command) send `Authorization: Bearer <service_role_key>`.
//   2. a signed-in admin/manager JWT -- BulkComposeDrawer in the admin UI
//      calls supabase.functions.invoke(), which attaches the user's JWT.
//
// Shape follows apex-outbox-dispatcher/index.ts:63-73, the repo's existing
// dual-accept gate, so there is one pattern here and not two.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON_KEY     = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

const SENDER_ROLES = new Set(["admin", "manager"]);

export interface SendAuthResult {
  ok: boolean;
  status: number;
  error?: string;
  /** "service" for internal callers, "user:<uuid>" for a signed-in admin. */
  caller?: string;
}

export async function requireSendAuth(req: Request): Promise<SendAuthResult> {
  const raw = req.headers.get("authorization") ?? "";
  const token = raw.replace(/^Bearer\s+/i, "").trim();

  if (!token) {
    return { ok: false, status: 401, error: "unauthorized" };
  }

  // Internal path. Constant-time compare so the key is not discoverable by
  // timing a few thousand probes against a public endpoint.
  if (SERVICE_KEY && safeEqual(token, SERVICE_KEY)) {
    return { ok: true, status: 200, caller: "service" };
  }

  // The anon key is a validly signed JWT that anyone can read out of the
  // deployed bundle. getUser() should reject it for want of a sub claim, but
  // this endpoint is too expensive to leave that to a library detail.
  if (ANON_KEY && safeEqual(token, ANON_KEY)) {
    return { ok: false, status: 401, error: "unauthorized" };
  }

  if (!SUPABASE_URL || !SERVICE_KEY) {
    // Never fail OPEN on a misconfigured environment.
    return { ok: false, status: 503, error: "sender auth unavailable" };
  }

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  const { data, error } = await sb.auth.getUser(token);
  if (error || !data?.user?.id) {
    return { ok: false, status: 401, error: "unauthorized" };
  }

  const { data: roles } = await sb
    .from("user_roles")
    .select("role")
    .eq("user_id", data.user.id);

  const hasSenderRole = (roles ?? []).some((r: { role: unknown }) =>
    SENDER_ROLES.has(String(r.role))
  );
  if (!hasSenderRole) {
    return { ok: false, status: 403, error: "forbidden: sending requires admin or manager" };
  }

  return { ok: true, status: 200, caller: `user:${data.user.id}` };
}

/** Length-independent constant-time string compare. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
