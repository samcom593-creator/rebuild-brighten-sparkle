import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { handleLeadRecordingUrl, type LeadRecordingUrlDependencies } from "../../../supabase/functions/_shared/lead-recording-url";

const id = "f7b7df44-5853-4cad-ae86-b9ef72930959";
const path = "callcenter/2026-11-24/example.webm";
const signedUrl = `https://storage.example.test/storage/v1/object/sign/call-recordings/${path}?token=synthetic`;
function dependencies() {
  return {
    getUser: vi.fn(async (): Promise<{ userId: string | null; error: unknown }> => ({ userId: "caller-a", error: null })),
    listRecordings: vi.fn(async (): Promise<{ data: unknown; error: unknown }> => ({ data: [{ id, path }], error: null })),
    signRecording: vi.fn(async (): Promise<{ data: unknown; error: unknown }> => ({ data: { signedUrl }, error: null })),
  } satisfies LeadRecordingUrlDependencies;
}
const request = (body: unknown = { recordingId: id }) => new Request("https://example.test/lead-recording-url", {
  method: "POST", headers: { Authorization: "Bearer caller-token" }, body: JSON.stringify(body),
});

describe("private lead recording signer", () => {
  it("signs only the exact path returned by the caller-authorized catalog", async () => {
    const deps = dependencies();
    const response = await handleLeadRecordingUrl(request(), deps);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ signedUrl, expiresInSeconds: 900 });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(deps.signRecording).toHaveBeenCalledExactlyOnceWith(path, 900);
    expect(deps.getUser.mock.invocationCallOrder[0]).toBeLessThan(deps.listRecordings.mock.invocationCallOrder[0]);
    expect(deps.listRecordings.mock.invocationCallOrder[0]).toBeLessThan(deps.signRecording.mock.invocationCallOrder[0]);
  });

  it("refuses an unverified caller before reading the catalog", async () => {
    const deps = dependencies();
    deps.getUser.mockResolvedValue({ userId: null, error: null });
    expect((await handleLeadRecordingUrl(request(), deps)).status).toBe(401);
    expect(deps.listRecordings).not.toHaveBeenCalled();
    expect(deps.signRecording).not.toHaveBeenCalled();
  });

  it("does not sign after the caller's RPC denies access", async () => {
    const deps = dependencies();
    deps.listRecordings.mockResolvedValue({ data: [{ id, path }], error: new Error("Admins only") });
    expect((await handleLeadRecordingUrl(request(), deps)).status).toBe(503);
    expect(deps.signRecording).not.toHaveBeenCalled();
  });

  it.each([[], [{ id: "other-recording", path }]].map(data => ({ data })))("does not substitute another recording %#", async ({ data }) => {
    const deps = dependencies();
    deps.listRecordings.mockResolvedValue({ data, error: null });
    expect((await handleLeadRecordingUrl(request(), deps)).status).toBe(404);
    expect(deps.signRecording).not.toHaveBeenCalled();
  });

  it.each([
    null, {}, [null], [{ id }], [{ id, path: "interviews/private.webm" }],
    [{ id, path: "callcenter/../private.webm" }], [{ id, path: "callcenter/%2e%2e/%2e%2e/other/file.webm" }],
    [{ id, path: "callcenter/file.webm?token=secret" }], [{ id, path }, { id, path }], [{ id, path }, {}],
  ].map(data => ({ data })))("fails closed on malformed or unsafe catalog data %#", async ({ data }) => {
    const deps = dependencies();
    deps.listRecordings.mockResolvedValue({ data, error: null });
    expect((await handleLeadRecordingUrl(request(), deps)).status).toBe(503);
    expect(deps.signRecording).not.toHaveBeenCalled();
  });

  it.each(["path", "bucket", "itemId", "userId", "expiresInSeconds"])("does not accept a caller-controlled %s", async field => {
    const deps = dependencies();
    expect((await handleLeadRecordingUrl(request({ recordingId: id, [field]: "spoof" }), deps)).status).toBe(400);
    expect(deps.listRecordings).not.toHaveBeenCalled();
    expect(deps.signRecording).not.toHaveBeenCalled();
  });

  it("keeps the catalog on the caller JWT and signing deferred to one fixed bucket", () => {
    const source = readFileSync(resolve(__dirname, "../../../supabase/functions/lead-recording-url/index.ts"), "utf8");
    expect(source).toContain('Authorization: req.headers.get("Authorization")');
    expect(source).toContain("caller().auth.getUser()");
    expect(source).toContain('listRecordings: () => caller().rpc("lead_recordings_recent", { p_limit: 200 })');
    expect(source).toContain('service.storage.from("call-recordings").createSignedUrl(path, expiresInSeconds)');
    expect(source.indexOf("SUPABASE_SERVICE_ROLE_KEY")).toBeGreaterThan(source.indexOf("signRecording: (path, expiresInSeconds)"));
  });
});
