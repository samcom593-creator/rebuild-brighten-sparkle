/**
 * applicant-magic-link — creates an auth user for a warm applicant (if
 * missing) and returns a Supabase NATIVE magic-link URL. Native = no custom
 * verify-magic-link round-trip; the URL logs them in directly via Supabase
 * Auth and lands at the requested `redirectPath`.
 *
 * Input:  { applicationId?: string, email?: string, firstName?: string,
 *           redirectPath?: '/dashboard' | '/onboarding-course' | string }
 * Output: { success, email, action_link, created_user: boolean,
 *           redirect_url: string }
 *
 * Default redirect is /dashboard. The post-application "Start your course"
 * flow passes redirectPath: '/onboarding-course' so the magic link drops
 * the newly-applied applicant straight into the training course in an
 * authenticated session (Sam directive 2026-06-15: "they're logged in and
 * everything like that. They should have the course click — point and
 * clear").
 *
 * Use it as the "send them the link" path mentioned by Sam 2026-04-23.
 *
 * MP-447 — WHY THIS ENDPOINT IS GATED THE WAY IT IS:
 * It mints a Supabase NATIVE magic link and RETURNS it in the response body,
 * under verify_jwt = false and Access-Control-Allow-Origin: *. Until MP-447 it
 * read no credential at all and accepted a caller-supplied `email`, so a bare
 * POST of {"email":"<any admin>"} returned a working login URL for that
 * account. That is account takeover, not a data leak.
 *
 * The gateway cannot be the gate, and neither can "require a real key":
 * BOTH legitimate callers authenticate with the PUBLIC anon key —
 *   1. the browser, via supabase.functions.invoke() from
 *      ApplicationConfirmationV2, on the post-application page of a visitor
 *      who by definition has no session yet, and
 *   2. pg_net from trg_applicant_autoprovision, which reads
 *      system_settings.supabase_anon_key and sends it as the Bearer token.
 * Requiring the service role would break the auto-login flow Sam asked for
 * ("they're logged in ... point and clear", 2026-06-15). So the fix is not a
 * blanket credential check; it is a narrowing of what an UNCREDENTIALED caller
 * is allowed to ask for:
 *
 *   a) `email` is now service-role-only. Neither real caller has ever passed
 *      it — both pass `applicationId` — so removing it costs nothing and
 *      deletes the arbitrary-account vector outright.
 *   b) No uncredentialed caller can mint for an account holding admin or
 *      manager. submit-application is PUBLIC, so anyone may put an admin's
 *      address on an application row; without (b), `applicationId` is the same
 *      escalation one hop further round. A lookup that cannot answer refuses:
 *      unknown is never treated as "not privileged".
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { findAuthUserByEmail } from "../_shared/find-auth-user.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SRV = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Roles that must never be handed a session by an applicant-facing minter.
const PRIVILEGED_ROLES = new Set(["admin", "manager"]);

/** Length-independent constant-time compare, per _shared/require-send-auth.ts. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * True only for the service role key. The anon key is deliberately NOT
 * accepted here: it ships inside the browser bundle, so it identifies nobody.
 */
function isServiceCaller(req: Request): boolean {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  return Boolean(token) && Boolean(SB_SRV) && safeEqual(token, SB_SRV);
}
const BASE_URL = "https://apex-financial.org";
const DEFAULT_REDIRECT_PATH = "/dashboard";
// Whitelist of acceptable redirect paths. Hard guard against open-redirect:
// the action_link is a high-trust magic-login URL, so we never let arbitrary
// caller-controlled redirect targets through.
const ALLOWED_REDIRECT_PATHS = new Set<string>([
  "/dashboard",
  "/onboarding-course",
  "/get-licensed",
  "/start-contracting",
  "/apex-daily-numbers",
  "/dashboard/clients",
  "/agent-portal",
]);

function resolveRedirectUrl(rawPath: unknown): string {
  if (typeof rawPath !== "string" || rawPath.length === 0) {
    return `${BASE_URL}${DEFAULT_REDIRECT_PATH}`;
  }
  // Only allow same-origin paths from the whitelist.
  if (!rawPath.startsWith("/") || rawPath.startsWith("//")) {
    return `${BASE_URL}${DEFAULT_REDIRECT_PATH}`;
  }
  if (!ALLOWED_REDIRECT_PATHS.has(rawPath)) {
    return `${BASE_URL}${DEFAULT_REDIRECT_PATH}`;
  }
  return `${BASE_URL}${rawPath}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const sb = createClient(SB_URL, SB_SRV, { auth: { persistSession: false } });
  const body = await req.json().catch(() => ({} as any));
  const serviceCaller = isServiceCaller(req);
  // A caller-supplied email is an arbitrary-account request. Only the service
  // role may make one; for everyone else the address must come from the
  // applications row that applicationId names.
  let email: string | null = serviceCaller ? (body.email ?? null) : null;
  let firstName: string | null = body.firstName ?? null;
  const REDIRECT = resolveRedirectUrl(body.redirectPath);

  if (body.applicationId) {
    const { data } = await sb.from("applications")
      .select("email, first_name")
      .eq("id", body.applicationId)
      .maybeSingle();
    email = (data as any)?.email ?? email;
    firstName = (data as any)?.first_name ?? firstName;
  }

  if (!email) {
    return new Response(JSON.stringify({ error: "email or applicationId required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  email = email.toLowerCase().trim();

  // Refuse to mint for an account that can administer the business. Runs
  // before createUser so a refusal creates nothing.
  if (!serviceCaller) {
    const lookup = await findAuthUserByEmail(sb as never, email);
    if (!lookup.exhaustive) {
      // The lookup gave up. Unknown coerces toward refusal — reading a failed
      // scan as "no such privileged user" is how this check would be bypassed.
      return new Response(JSON.stringify({ error: "eligibility_unverifiable" }), {
        status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (lookup.user) {
      const { data: roles, error: rolesErr } = await sb
        .from("user_roles").select("role").eq("user_id", lookup.user.id);
      if (rolesErr) {
        return new Response(JSON.stringify({ error: "eligibility_unverifiable" }), {
          status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if ((roles ?? []).some((r: { role: unknown }) => PRIVILEGED_ROLES.has(String(r.role)))) {
        return new Response(JSON.stringify({ error: "not_eligible_for_magic_link" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }
  }

  let createdUser = false;

  // 1) Create auth user if missing. createUser returns 422 if email taken — treat as idempotent.
  const { data: createRes, error: createErr } = await sb.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { source: "applicant_magic_link", first_name: firstName },
  });
  if (createErr) {
    const msg = (createErr as any)?.message ?? "";
    const status = (createErr as any)?.status ?? 0;
    // Idempotent on any "user exists" signal from Supabase Auth
    const isDuplicate = status === 422 || /already/i.test(msg);
    if (!isDuplicate) {
      return new Response(JSON.stringify({ error: "create_user_failed", detail: msg }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  } else if (createRes?.user) {
    createdUser = true;
  }

  // 2) Generate native magic link
  const { data: linkRes, error: linkErr } = await sb.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo: REDIRECT },
  });
  if (linkErr) {
    return new Response(JSON.stringify({ error: "generate_link_failed", detail: (linkErr as any)?.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const action_link = (linkRes as any)?.properties?.action_link ?? (linkRes as any)?.action_link;
  if (!action_link) {
    return new Response(JSON.stringify({ error: "no_action_link", detail: JSON.stringify(linkRes).slice(0, 300) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({
    success: true, email, firstName, action_link, created_user: createdUser,
    redirect_url: REDIRECT,
  }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
