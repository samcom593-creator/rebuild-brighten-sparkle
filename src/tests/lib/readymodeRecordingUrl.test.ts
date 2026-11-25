import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { handleReadyModeRecordingUrl, type ReadyModeRecordingUrlDependencies } from "../../../supabase/functions/_shared/readymode-recording-url";

const callId = "11111111-1111-4111-8111-111111111111";
const otherCallId = "22222222-2222-4222-8222-222222222222";
const row = { call_id: callId, path: "team/call-a.mp3", variant: "client_data_removed", duration_seconds: 125, muted_ranges: [] };
const signedUrl = "https://storage.example.test/storage/v1/object/sign/readymode-audio/team/call-a.mp3?token=synthetic";
function dependencies() {
  return {
    getUser: vi.fn(async (): Promise<{ userId: string | null; error: unknown }> => ({ userId: "caller-a", error: null })),
    resolveRecording: vi.fn(async (): Promise<{ data: unknown; error: unknown }> => ({ data: [row], error: null })),
    signRecording: vi.fn(async (): Promise<{ data: unknown; error: unknown }> => ({ data: { signedUrl }, error: null })),
  } satisfies ReadyModeRecordingUrlDependencies;
}
function request(body: unknown = { callId }, method = "POST", authorization: string | null = "Bearer caller-token") {
  return new Request("https://example.test/readymode-recording-url", {
    method, headers: authorization ? { Authorization: authorization } : {},
    ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
  });
}

describe("ReadyMode recording signer", () => {
  it.each([["OPTIONS", 200], ["GET", 405]] as const)("handles %s without authorization/signing work", async (method, status) => {
    const deps = dependencies();
    const response = await handleReadyModeRecordingUrl(request(undefined, method), deps);
    expect(response.status).toBe(status);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(deps.getUser).not.toHaveBeenCalled();
    expect(deps.resolveRecording).not.toHaveBeenCalled();
    expect(deps.signRecording).not.toHaveBeenCalled();
  });

  it.each([null, "", "Basic caller", "Bearer first second"])("refuses malformed bearer %s", async authorization => {
    const deps = dependencies();
    expect((await handleReadyModeRecordingUrl(request({}, "POST", authorization), deps)).status).toBe(401);
    expect(deps.getUser).not.toHaveBeenCalled();
    expect(deps.resolveRecording).not.toHaveBeenCalled();
    expect(deps.signRecording).not.toHaveBeenCalled();
  });

  it.each([{ userId: null, error: null }, { userId: "caller-a", error: new Error("expired") }])("refuses an unverified user", async auth => {
    const deps = dependencies();
    deps.getUser.mockResolvedValue(auth);
    expect((await handleReadyModeRecordingUrl(request(), deps)).status).toBe(401);
    expect(deps.resolveRecording).not.toHaveBeenCalled();
    expect(deps.signRecording).not.toHaveBeenCalled();
  });

  it.each(["path", "bucket", "variant", "url", "userId", "expiresInSeconds"])("rejects client-selected %s", async field => {
    const deps = dependencies();
    expect((await handleReadyModeRecordingUrl(request({ callId, [field]: "spoof" }), deps)).status).toBe(400);
    expect(deps.resolveRecording).not.toHaveBeenCalled();
    expect(deps.signRecording).not.toHaveBeenCalled();
  });

  it.each([null, [], {}, { callId: "provider-call-42" }, { callId: "" }, { callId: 42 }, { callId: `${callId} ` }].map(body => ({ body })))("rejects malformed/internal-ID-missing input %#", async ({ body }) => {
    const deps = dependencies();
    expect((await handleReadyModeRecordingUrl(request(body), deps)).status).toBe(400);
    expect(deps.resolveRecording).not.toHaveBeenCalled();
    expect(deps.signRecording).not.toHaveBeenCalled();
  });

  it("fails closed on unreadable JSON", async () => {
    const deps = dependencies();
    const req = new Request("https://example.test/readymode-recording-url", { method: "POST", headers: { Authorization: "Bearer caller-token" }, body: "{" });
    expect((await handleReadyModeRecordingUrl(req, deps)).status).toBe(400);
    expect(deps.signRecording).not.toHaveBeenCalled();
  });

  it.each([null, {}, [null], [{}], [row, row], [{ ...row, call_id: otherCallId }], [{ ...row, variant: "raw" }],
    [{ ...row, duration_seconds: undefined }], [{ ...row, duration_seconds: -1 }], [{ ...row, duration_seconds: 1.5 }], [{ ...row, muted_ranges: null }],
  ].map(data => ({ data })))("rejects malformed, extra, wrong-identity or invalid-variant rows %#", async ({ data }) => {
    const deps = dependencies();
    deps.resolveRecording.mockResolvedValue({ data, error: null });
    expect((await handleReadyModeRecordingUrl(request(), deps)).status).toBe(503);
    expect(deps.signRecording).not.toHaveBeenCalled();
  });

  it.each(["https://provider.example.test/file.mp3", "/raw.mp3", "../raw.mp3", "safe/../raw.mp3", "safe\\raw.mp3", "raw.mp3?token=secret", "",
    "team/%2e%2e/%2e%2e/private-bucket/file.mp3", "team/%2E%2E/file.mp3", "team/%2fraw.mp3", "team/%5Craw.mp3", "team/%252e%252e/file.mp3",
  ])("rejects unsafe server-selected path %s", async path => {
    const deps = dependencies();
    deps.resolveRecording.mockResolvedValue({ data: [{ ...row, path }], error: null });
    expect((await handleReadyModeRecordingUrl(request(), deps)).status).toBe(503);
    expect(deps.signRecording).not.toHaveBeenCalled();
  });

  it("returns a neutral no-copy receipt for a verified empty RPC response, without signing", async () => {
    const deps = dependencies();
    deps.resolveRecording.mockResolvedValue({ data: [], error: null });
    const response = await handleReadyModeRecordingUrl(request(), deps);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ recording: null });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(deps.signRecording).not.toHaveBeenCalled();
  });

  it("fails closed on RPC error even when rows were also returned", async () => {
    const deps = dependencies();
    deps.resolveRecording.mockResolvedValue({ data: [row], error: new Error("secret table details") });
    const response = await handleReadyModeRecordingUrl(request(), deps);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("secret table details");
    expect(deps.signRecording).not.toHaveBeenCalled();
  });

  it.each(["full", "numbers_muted", "client_data_removed"])("preserves the RPC-selected %s variant and exact path", async variant => {
    const deps = dependencies();
    const path = variant === "full" ? "raw/call-a.mp3" : variant === "numbers_muted" ? "redacted/call-a.mp3" : row.path;
    deps.resolveRecording.mockResolvedValue({ data: [{ ...row, path, variant, duration_seconds: null }], error: null });
    const response = await handleReadyModeRecordingUrl(request(), deps);
    expect(response.status).toBe(200);
    expect(deps.resolveRecording).toHaveBeenCalledExactlyOnceWith(callId);
    expect(deps.getUser.mock.invocationCallOrder[0]).toBeLessThan(deps.resolveRecording.mock.invocationCallOrder[0]);
    expect(deps.resolveRecording.mock.invocationCallOrder[0]).toBeLessThan(deps.signRecording.mock.invocationCallOrder[0]);
    expect(deps.signRecording).toHaveBeenCalledExactlyOnceWith(path, 900);
    expect(await response.json()).toEqual({ signedUrl, expiresInSeconds: 900, variant });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it.each([{ data: null, error: null }, { data: { signedUrl: "javascript:bad" }, error: null },
    { data: { signedUrl: "http://provider.example.test/file" }, error: null }, { data: { signedUrl }, error: new Error("secret signing error") },
  ])("refuses invalid signing receipts %#", async receipt => {
    const deps = dependencies();
    deps.signRecording.mockResolvedValue(receipt);
    const response = await handleReadyModeRecordingUrl(request(), deps);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("secret signing error");
  });

  it("does not leak unexpected exception details", async () => {
    const deps = dependencies();
    deps.resolveRecording.mockRejectedValue(new Error("caller-token must stay private"));
    const response = await handleReadyModeRecordingUrl(request(), deps);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("caller-token");
    expect(deps.signRecording).not.toHaveBeenCalled();
  });

  it("pins the RPC to the verified caller and signing to the readymode-audio bucket", () => {
    const source = readFileSync(resolve(__dirname, "../../../supabase/functions/readymode-recording-url/index.ts"), "utf8");
    expect(source).toContain('Authorization: req.headers.get("Authorization")');
    expect(source).toContain("caller().auth.getUser()");
    expect(source).toContain('resolveRecording: (callId) => caller().rpc("call_audio_for", { p_call_ids: [callId] })');
    expect(source).toContain('service.storage.from("readymode-audio").createSignedUrl(path, expiresInSeconds)');
    expect(source.indexOf("SUPABASE_SERVICE_ROLE_KEY")).toBeGreaterThan(source.indexOf("signRecording: (path, expiresInSeconds)"));
    const config = readFileSync(resolve(__dirname, "../../../supabase/config.toml"), "utf8");
    expect(config).toMatch(/\[functions\.readymode-recording-url\]\s*verify_jwt\s*=\s*true/);
  });
});
