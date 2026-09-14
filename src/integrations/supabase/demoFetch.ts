/**
 * demoFetch — the one place demo mode intercepts data.
 *
 * Wraps boundedFetch rather than replacing it, so the concurrency cap that
 * stops dashboards 500ing under their query burst still applies. Order matters:
 * bound first, then mask the response that comes back.
 *
 * Only READ responses are rewritten:
 *   - A POST/PATCH/DELETE during a demo still writes real data. This is a
 *     display mask, not a sandbox, and silently discarding Sam's writes would
 *     be a fake success of exactly the kind this codebase keeps finding. Note
 *     what that sentence does and does not license: we never alter a REQUEST,
 *     and we never block a write. Rewriting the response BODY the browser
 *     renders does neither.
 *   - MP-530: the gate used to be `method === "GET"`, which read as "reads
 *     only" and was not. supabase-js issues .rpc() as POST, so all 178 .rpc()
 *     call sites — the entire public landing page included — came back
 *     unmasked while the banner told the room every number and name on screen
 *     was fake. Proven on live prod: /rpc/landing_deal_highlights rendered
 *     real agent names (OBIAJULU, EDWIN, WENDELL, CHUDI) beside real amounts
 *     ($20,695, $19,118, ...), and /rpc/landing_recent_hires rendered a real
 *     hire and manager, all under the "nothing here is live client data"
 *     banner. A read carried over POST is still a read.
 *   - So: GET anywhere under /rest/v1 or /functions/v1, plus POST to
 *     /rest/v1/rpc/ and to /functions/v1/. A POST straight at /rest/v1/<table>
 *     is a genuine table write and is left alone.
 *   - Masking a write's response could not corrupt app state even where the
 *     two overlap: PROTECTED_KEY means ids, uuids, foreign keys, slugs, urls,
 *     tokens, enums, statuses and timestamps are never rewritten, so anything
 *     the app uses for logic survives the mask untouched.
 *   - /rest/v1 and /functions/v1 only. Auth, storage and realtime are never
 *     touched — masking a token refresh would end the session.
 *   - Non-JSON bodies pass through untouched.
 *
 * A failure to mask must never break the page: if anything in the mask throws,
 * the original response is returned unchanged. That is the safe direction for
 * availability, and it is why the banner is driven by the same flag rather than
 * by "did masking succeed" — the user is told they are in demo mode either way.
 */

import { boundedFetch } from "./boundedFetch";
import { isDemoMode, maskPayload, primeNames } from "@/lib/demoMode";

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return (input as Request).url ?? "";
}

function methodOf(input: RequestInfo | URL, init?: RequestInit): string {
  return (init?.method ?? (input as Request)?.method ?? "GET").toUpperCase();
}

/**
 * Is this response a READ the demo is allowed to rewrite?
 *
 * GET is always a read. POST is a read when it targets an RPC or an edge
 * function, because that is how supabase-js sends .rpc() and .functions.invoke()
 * — the verb describes the transport, not the intent. POST at a table is a
 * genuine write and is excluded, so an insert's returning-row renders exactly
 * what was stored.
 */
function isReadResponse(url: string, method: string): boolean {
  if (method === "GET") return true;
  if (method !== "POST") return false;
  return url.includes("/rest/v1/rpc/") || url.includes("/functions/v1/");
}


/**
 * The roster read that seeds demo mode's name map (MP-533).
 *
 * Reuses the headers of the request we are already intercepting, so the prime
 * runs with EXACTLY the caller's own authority — no second credential to keep
 * in sync, and no chance of the prime seeing rows the page itself cannot. An
 * anonymous session gets `[]` back from the RLS gate, which primeNames records
 * as `empty` rather than as a success.
 *
 * Calls the global fetch on purpose, not demoFetch: masking the roster would
 * teach the map its own fake names, and routing it back through the SDK would
 * recurse. This request is never masked and never rendered.
 */
/** Bounded so an unanswered roster read degrades demo mode instead of hanging it. */
const ROSTER_TIMEOUT_MS = 6000;

function rosterLoader(url: string, input: RequestInfo | URL, init?: RequestInit) {
  return async (): Promise<string[]> => {
    const base = url.split("/rest/v1")[0].split("/functions/v1")[0];
    const headers = new Headers(
      (init?.headers as HeadersInit | undefined) ??
        (input instanceof Request ? input.headers : undefined),
    );
    const apikey = headers.get("apikey") ?? "";
    const auth = headers.get("Authorization") ?? "";
    if (!base || !apikey) throw new Error("demo prime: no endpoint or key on the intercepted request");

    // BOUNDED, because this load is awaited. Every masked response in the demo
    // queues behind the first one, so a roster read that hangs does not degrade
    // the mask — it freezes the whole walkthrough on a blank screen. Found by
    // reading back the fix rather than by a failure: the await that makes this
    // a fix instead of a race is the same await that makes a hang fatal.
    // A timeout lands as `failed`, which the banner already reports honestly.
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), ROSTER_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(
        `${base}/rest/v1/agents?select=display_name&display_name=not.is.null&limit=1000`,
        { headers: { apikey, ...(auth ? { Authorization: auth } : {}) }, signal: abort.signal },
      );
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new Error(`demo prime: roster read ${res.status}`);
    const rows = (await res.json()) as Array<{ display_name?: unknown }>;
    if (!Array.isArray(rows)) throw new Error("demo prime: roster read returned a non-array");
    return rows
      .map((r) => r?.display_name)
      .filter((n): n is string => typeof n === "string" && n.trim().length > 0);
  };
}

export async function demoFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const response = await boundedFetch(input, init);

  if (!isDemoMode()) return response;

  const url = urlOf(input);
  const isData = url.includes("/rest/v1") || url.includes("/functions/v1");
  if (!isData || !isReadResponse(url, methodOf(input, init))) return response;
  if (!response.ok) return response;

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("json")) return response;

  try {
    const clone = response.clone();
    const body = await clone.json();
    // AWAITED, not fired-and-forgotten. Priming the name map in the background
    // when demo mode turns on would leave the first payloads masked against an
    // empty map — the same ordering race MP-532 could not close, relocated.
    // Once per demo session; every later request awaits the same promise.
    await primeNames(rosterLoader(url, input, init));
    const masked = maskPayload(body);
    return new Response(JSON.stringify(masked), {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } catch {
    // empty-catch-allow:mask-must-never-break-the-page; original response is returned
    return response;
  }
}
