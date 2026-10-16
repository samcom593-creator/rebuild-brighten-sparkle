/**
 * AI service liveness probe (F36).
 *
 * The Settings Assistant tab used to print "Workspace assistant enabled" as
 * static copy. The only honest states are "not verified" and whatever a real
 * check returned. The check sends the ai-assistant edge function a request
 * type it does not know. The function validates the caller's session and
 * checks that its model key is configured BEFORE it reads the request type,
 * and its switch default throws "Invalid request type", which comes back as a
 * 500 with that message. So that exact message proves three things at zero
 * model spend: the function boots, this session is accepted, and the key is
 * present. It proves nothing about model responses, and the copy says so.
 *
 * A worker that dies at boot (the MP-273 class) never answers at all; the
 * relay answers for it with { code, message } and no error field. That is
 * reported in the relay's own words and never counts as the function
 * speaking, so only the function's error field can match the marker.
 */

export const ASSISTANT_PROBE_BODY = { type: "service-probe" } as const;

/** The literal the deployed function throws for an unknown request type. Any other text is not a pass. */
export const ASSISTANT_PROBE_MARKER = "Invalid request type";

export type AssistantProbeStatus = "reachable" | "not-configured" | "session-rejected" | "unverified";

export interface AssistantProbeVerdict {
  status: AssistantProbeStatus;
  headline: string;
  detail: string;
}

export interface AssistantProbeInput {
  /** HTTP status of the response, or null when no response arrived. */
  httpStatus: number | null;
  /** Parsed JSON body when there was one. */
  body: unknown;
  /** Message of a transport failure (no response at all). */
  transportError?: string | null;
}

/** The function's own { error } text. Only this field can match the marker. */
function functionError(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const err = (body as { error?: unknown }).error;
  return typeof err === "string" ? err : null;
}

/** The relay's { code, message } when the worker never answered. */
function relayMessage(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const { code, message } = body as { code?: unknown; message?: unknown };
  if (typeof message !== "string" || message === "") return null;
  return typeof code === "string" && code !== "" ? `${code}: ${message}` : message;
}

export function classifyAssistantProbe(input: AssistantProbeInput): AssistantProbeVerdict {
  const err = functionError(input.body);
  if (err === ASSISTANT_PROBE_MARKER) {
    return {
      status: "reachable",
      headline: "Reachable and configured",
      detail: "The AI service answered and its model key is set. The check sends no prompt, so model responses are not verified.",
    };
  }
  if (err && /not configured/i.test(err)) {
    return {
      status: "not-configured",
      headline: "Running, but no model key",
      detail: `The AI service is running but reported: ${err}. AI features will fail until the key is set on the function.`,
    };
  }
  if (input.httpStatus === 401) {
    return {
      status: "session-rejected",
      headline: "Session not accepted",
      detail: "The AI service did not accept this session. Sign out and back in, then check again.",
    };
  }
  if (input.transportError) {
    return {
      status: "unverified",
      headline: "Not verified",
      detail: `Could not reach the AI service: ${input.transportError}`,
    };
  }
  if (input.httpStatus !== null && input.httpStatus >= 200 && input.httpStatus < 300) {
    return {
      status: "unverified",
      headline: "Not verified",
      detail: "The AI service accepted a request it should have rejected, so its contract has changed and this check cannot vouch for it.",
    };
  }
  const relay = relayMessage(input.body);
  return {
    status: "unverified",
    headline: "Not verified",
    detail: err
      ? `The AI service answered with an error: ${err}`
      : relay
        ? `The AI service did not answer; the relay reported: ${relay}`
        : `Unexpected response from the AI service (HTTP ${input.httpStatus ?? "none"}).`,
  };
}
