import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { handleTrainingRecordingUrl, TRAINING_RECORDING_URL_TTL, type TrainingRecordingUrlDependencies } from "../../../supabase/functions/_shared/training-recording-url";

const recording = { id: "lesson-a", audio_path: "redacted/lesson-a.mp3", title: "Training call" };
const signedUrl = "https://storage.example.test/storage/v1/object/sign/training-recordings/redacted/lesson-a.mp3?token=synthetic";
function dependencies() {
  return {
    getUser: vi.fn(async (): Promise<{ userId: string | null; error: unknown }> => ({ userId: "caller-a", error: null })),
    listRecordings: vi.fn(async (): Promise<{ data: unknown; error: unknown }> => ({ data: [recording], error: null })),
    signRecording: vi.fn(async (): Promise<{ data: unknown; error: unknown }> => ({ data: { signedUrl }, error: null })),
  } satisfies TrainingRecordingUrlDependencies;
}
function request(body: unknown = { recordingId: recording.id }, method = "POST", authorization: string | null = "Bearer caller-token") {
  return new Request("https://example.test/training-recording-url", {
    method, headers: authorization ? { Authorization: authorization } : {},
    ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
  });
}

describe("private training recording signer", () => {
  it.each([["OPTIONS", 200], ["GET", 405]] as const)("handles %s without identity/catalog/signing work", async (method, status) => {
    const deps = dependencies();
    const response = await handleTrainingRecordingUrl(request(undefined, method), deps);
    expect(response.status).toBe(status);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(deps.getUser).not.toHaveBeenCalled();
    expect(deps.listRecordings).not.toHaveBeenCalled();
    expect(deps.signRecording).not.toHaveBeenCalled();
  });

  it.each([null, "", "Basic caller", "Bearer first second"])("refuses malformed authentication %s before any access", async authorization => {
    const deps = dependencies();
    expect((await handleTrainingRecordingUrl(request({}, "POST", authorization), deps)).status).toBe(401);
    expect(deps.getUser).not.toHaveBeenCalled();
    expect(deps.listRecordings).not.toHaveBeenCalled();
    expect(deps.signRecording).not.toHaveBeenCalled();
  });

  it.each([{ userId: null, error: null }, { userId: "caller-a", error: new Error("expired token") }])("refuses unverified authentication before catalog access", async auth => {
    const deps = dependencies();
    deps.getUser.mockResolvedValue(auth);
    expect((await handleTrainingRecordingUrl(request(), deps)).status).toBe(401);
    expect(deps.listRecordings).not.toHaveBeenCalled();
    expect(deps.signRecording).not.toHaveBeenCalled();
  });

  it.each(["bucket", "path", "audio_path", "url", "userId", "expiresInSeconds"])("rejects caller-controlled %s before catalog/signing", async field => {
    const deps = dependencies();
    expect((await handleTrainingRecordingUrl(request({ recordingId: recording.id, [field]: "spoof" }), deps)).status).toBe(400);
    expect(deps.listRecordings).not.toHaveBeenCalled();
    expect(deps.signRecording).not.toHaveBeenCalled();
  });

  it.each([null, [], {}, { recordingId: "" }, { recordingId: " lesson-a " }, { recordingId: 4 }].map(body => ({ body })))("rejects a malformed request %#", async ({ body }) => {
    const deps = dependencies();
    expect((await handleTrainingRecordingUrl(request(body), deps)).status).toBe(400);
    expect(deps.signRecording).not.toHaveBeenCalled();
  });

  it("fails closed on unreadable JSON", async () => {
    const deps = dependencies();
    const req = new Request("https://example.test/training-recording-url", { method: "POST", headers: { Authorization: "Bearer caller-token" }, body: "{" });
    expect((await handleTrainingRecordingUrl(req, deps)).status).toBe(400);
    expect(deps.signRecording).not.toHaveBeenCalled();
  });

  it.each([null, {}, [null], [{ id: "lesson-a" }], [{ ...recording, id: 5 }], [recording, recording]].map(data => ({ data })))("refuses a malformed or duplicate catalog %#", async ({ data }) => {
    const deps = dependencies();
    deps.listRecordings.mockResolvedValue({ data, error: null });
    expect((await handleTrainingRecordingUrl(request(), deps)).status).toBe(503);
    expect(deps.signRecording).not.toHaveBeenCalled();
  });

  it.each([[], [{ ...recording, id: "other-lesson" }]].map(data => ({ data })))("refuses a missing authorized record %#", async ({ data }) => {
    const deps = dependencies();
    deps.listRecordings.mockResolvedValue({ data, error: null });
    expect((await handleTrainingRecordingUrl(request(), deps)).status).toBe(404);
    expect(deps.signRecording).not.toHaveBeenCalled();
  });

  it.each([
    "https://provider.example.test/private.mp3", "/raw.mp3", "../raw.mp3", "safe/../raw.mp3", "safe\\raw.mp3", "safe.mp3?token=secret", "",
    "redacted/%2e%2e/%2e%2e/private-bucket/file.mp3", "redacted/%2E%2E/file.mp3", "redacted/%2fprivate.mp3", "redacted/%5Cprivate.mp3", "redacted/%252e%252e/file.mp3",
  ])('refuses unsafe catalog path "%s"', async audio_path => {
    const deps = dependencies();
    deps.listRecordings.mockResolvedValue({ data: [{ ...recording, audio_path }], error: null });
    expect((await handleTrainingRecordingUrl(request(), deps)).status).toBe(503);
    expect(deps.signRecording).not.toHaveBeenCalled();
  });

  it("does not sign a partial row when the catalog also contains malformed data", async () => {
    const deps = dependencies();
    deps.listRecordings.mockResolvedValue({ data: [recording, {}], error: null });
    expect((await handleTrainingRecordingUrl(request(), deps)).status).toBe(503);
    expect(deps.signRecording).not.toHaveBeenCalled();
  });

  it("does not sign after a caller catalog error or leak the error text", async () => {
    const deps = dependencies();
    deps.listRecordings.mockResolvedValue({ data: [recording], error: new Error("secret path and token") });
    const response = await handleTrainingRecordingUrl(request(), deps);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("secret path and token");
    expect(deps.signRecording).not.toHaveBeenCalled();
  });

  it("signs only the exact authorized path after identity/catalog checks and returns no catalog data", async () => {
    const deps = dependencies();
    const response = await handleTrainingRecordingUrl(request(), deps);
    expect(response.status).toBe(200);
    expect(deps.getUser.mock.invocationCallOrder[0]).toBeLessThan(deps.listRecordings.mock.invocationCallOrder[0]);
    expect(deps.listRecordings.mock.invocationCallOrder[0]).toBeLessThan(deps.signRecording.mock.invocationCallOrder[0]);
    expect(deps.signRecording).toHaveBeenCalledExactlyOnceWith(recording.audio_path, 900);
    expect(TRAINING_RECORDING_URL_TTL).toBe(900);
    expect(await response.json()).toEqual({ signedUrl, expiresInSeconds: 900 });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it.each([
    { data: null, error: null }, { data: { signedUrl: "javascript:bad" }, error: null },
    { data: { signedUrl: "http://provider.example.test/file" }, error: null },
    { data: { signedUrl }, error: new Error("secret provider error") },
  ])("fails closed on an invalid signing receipt %#", async result => {
    const deps = dependencies();
    deps.signRecording.mockResolvedValue(result);
    const response = await handleTrainingRecordingUrl(request(), deps);
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.text()).not.toContain("secret provider error");
  });

  it("contains unexpected exceptions without returning private details", async () => {
    const deps = dependencies();
    deps.getUser.mockRejectedValue(new Error("caller token must not escape"));
    const response = await handleTrainingRecordingUrl(request(), deps);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("caller token");
    expect(deps.signRecording).not.toHaveBeenCalled();
  });

  it("binds catalog reads to the caller and the service signer to one fixed private bucket", () => {
    const source = readFileSync(resolve(__dirname, "../../../supabase/functions/training-recording-url/index.ts"), "utf8");
    expect(source).toContain('Authorization: req.headers.get("Authorization")');
    expect(source).toContain("caller().auth.getUser()");
    expect(source).toContain('listRecordings: () => caller().rpc("training_recordings_list")');
    expect(source).toContain('service.storage.from("training-recordings").createSignedUrl(path, expiresInSeconds)');
    expect(source.indexOf('SUPABASE_SERVICE_ROLE_KEY')).toBeGreaterThan(source.indexOf("signRecording: (path, expiresInSeconds)"));
    const config = readFileSync(resolve(__dirname, "../../../supabase/config.toml"), "utf8");
    expect(config).toMatch(/\[functions\.training-recording-url\]\s*verify_jwt\s*=\s*true/);
  });
});
