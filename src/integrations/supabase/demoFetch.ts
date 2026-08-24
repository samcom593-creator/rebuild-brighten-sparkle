/**
 * demoFetch — the one place demo mode intercepts data.
 *
 * Wraps boundedFetch rather than replacing it, so the concurrency cap that
 * stops dashboards 500ing under their query burst still applies. Order matters:
 * bound first, then mask the response that comes back.
 *
 * Only READ responses are rewritten:
 *   - GET only. A POST/PATCH/DELETE during a demo still writes real data.
 *     This is a display mask, not a sandbox, and silently discarding Sam's
 *     writes would be a fake success of exactly the kind this codebase keeps
 *     finding.
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
import { isDemoMode, maskPayload } from "@/lib/demoMode";

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return (input as Request).url ?? "";
}

function methodOf(input: RequestInfo | URL, init?: RequestInit): string {
  return (init?.method ?? (input as Request)?.method ?? "GET").toUpperCase();
}

export async function demoFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const response = await boundedFetch(input, init);

  if (!isDemoMode()) return response;

  const url = urlOf(input);
  const isData = url.includes("/rest/v1") || url.includes("/functions/v1");
  if (!isData || methodOf(input, init) !== "GET") return response;
  if (!response.ok) return response;

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("json")) return response;

  try {
    const clone = response.clone();
    const body = await clone.json();
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
