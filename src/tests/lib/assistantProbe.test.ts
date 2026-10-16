/**
 * F36: the Assistant tab's health label must come from a real result. Only the
 * deployed function's own "Invalid request type" message counts as reachable;
 * everything else reads as a specific failure or as not verified.
 *
 * The set of request types the function accepts is read from its source, not
 * copied here, so a new case in the switch is pinned the moment it lands.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ASSISTANT_PROBE_BODY, ASSISTANT_PROBE_MARKER, classifyAssistantProbe } from "@/lib/assistantProbe";

const FUNCTION_SOURCE = fs.readFileSync(path.resolve(__dirname, "../../../supabase/functions/ai-assistant/index.ts"), "utf8");
const KNOWN_REQUEST_TYPES = Array.from(FUNCTION_SOURCE.matchAll(/case\s+['"]([^'"]+)['"]\s*:/g), (m) => m[1]);

describe("classifyAssistantProbe", () => {
  it("sends a request type the function does not know, so no prompt reaches a model", () => {
    expect(ASSISTANT_PROBE_BODY.type).toBe("service-probe");
    // The six cases known today must all be found, so a parse that silently found nothing cannot pass.
    for (const known of ["coaching", "summary", "chat", "performance_breakdown", "recruiter_insights", "weekly_digest"]) {
      expect(KNOWN_REQUEST_TYPES).toContain(known);
    }
    expect(KNOWN_REQUEST_TYPES).not.toContain(ASSISTANT_PROBE_BODY.type);
  });

  it("pins the marker to the literal the function throws for an unknown type", () => {
    expect(FUNCTION_SOURCE).toMatch(new RegExp(`['"\`]${ASSISTANT_PROBE_MARKER}['"\`]`));
  });

  it("is reachable only on the function's own unknown-type message", () => {
    const v = classifyAssistantProbe({ httpStatus: 500, body: { error: ASSISTANT_PROBE_MARKER } });
    expect(v.status).toBe("reachable");
    expect(v.detail).toMatch(/not verified/i);
  });

  it("reports a missing model key as its own state, never as reachable", () => {
    const v = classifyAssistantProbe({ httpStatus: 500, body: { error: "LOVABLE_API_KEY is not configured" } });
    expect(v.status).toBe("not-configured");
    expect(v.detail).toContain("LOVABLE_API_KEY is not configured");
  });

  it("reports a rejected session", () => {
    expect(classifyAssistantProbe({ httpStatus: 401, body: { error: "Invalid token" } }).status).toBe("session-rejected");
  });

  it("reads as not verified when nothing came back", () => {
    const v = classifyAssistantProbe({ httpStatus: null, body: null, transportError: "Failed to fetch" });
    expect(v.status).toBe("unverified");
    expect(v.headline).toBe("Not verified");
    expect(v.detail).toContain("Failed to fetch");
  });

  it("reads as not verified when the function accepted the probe (contract changed)", () => {
    const v = classifyAssistantProbe({ httpStatus: 200, body: { response: "hello" } });
    expect(v.status).toBe("unverified");
    expect(v.detail).toMatch(/contract has changed/);
  });

  it("reads as not verified on any other error text or a bodiless failure", () => {
    expect(classifyAssistantProbe({ httpStatus: 500, body: { error: "AI Gateway error: 502" } }).status).toBe("unverified");
    expect(classifyAssistantProbe({ httpStatus: 502, body: null }).status).toBe("unverified");
    expect(classifyAssistantProbe({ httpStatus: 500, body: "not json" }).status).toBe("unverified");
  });

  it("reports a worker that died at boot with the relay's own code and message", () => {
    const v = classifyAssistantProbe({ httpStatus: 503, body: { code: "BOOT_ERROR", message: "Function failed to start (please check logs)" } });
    expect(v.status).toBe("unverified");
    expect(v.headline).toBe("Not verified");
    expect(v.detail).toContain("BOOT_ERROR");
    expect(v.detail).toContain("Function failed to start (please check logs)");
  });

  it("never lets a relay message pass as the function speaking", () => {
    expect(classifyAssistantProbe({ httpStatus: 500, body: { message: ASSISTANT_PROBE_MARKER } }).status).toBe("unverified");
    expect(classifyAssistantProbe({ httpStatus: 500, body: { code: "WORKER_ERROR", message: "LOVABLE_API_KEY is not configured" } }).status).toBe("unverified");
  });

  it("never passes on a near miss of the marker", () => {
    expect(classifyAssistantProbe({ httpStatus: 500, body: { error: "invalid request type" } }).status).toBe("unverified");
    expect(classifyAssistantProbe({ httpStatus: 500, body: { error: "Invalid request type: x" } }).status).toBe("unverified");
  });
});
