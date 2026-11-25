import { isPrivateRecordingPath } from "./private-recording-path.ts";

export const READYMODE_RECORDING_URL_TTL = 900;
type Result = { data: unknown; error: unknown };
export interface ReadyModeRecordingUrlDependencies {
  getUser(): Promise<{ userId: string | null; error: unknown }>;
  resolveRecording(callId: string): PromiseLike<Result>;
  signRecording(path: string, expiresInSeconds: number): PromiseLike<Result>;
}
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
};
const json = (value: unknown, status: number) => new Response(JSON.stringify(value), {
  status, headers: { ...cors, "Content-Type": "application/json" },
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const variants = new Set(["full", "numbers_muted", "client_data_removed"]);

/** Sign only the file and privacy variant the existing caller-authorized RPC selects. */
export async function handleReadyModeRecordingUrl(req: Request, deps: ReadyModeRecordingUrlDependencies): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only." }, 405);
  if (!/^Bearer\s+\S+$/i.test(req.headers.get("Authorization") ?? "")) return json({ error: "Sign in required." }, 401);
  try {
    const auth = await deps.getUser();
    if (auth.error || typeof auth.userId !== "string" || !auth.userId.trim()) return json({ error: "Sign in required." }, 401);
    let body: unknown;
    try { body = await req.json(); }
    catch { return json({ error: "An internal call ID is required." }, 400); }
    if (!object(body) || Object.keys(body).length !== 1 || typeof body.callId !== "string" || !UUID.test(body.callId)) {
      return json({ error: "Provide only an internal call ID." }, 400);
    }
    const callId = body.callId.toLowerCase();
    const result = await deps.resolveRecording(callId);
    if (result.error || !Array.isArray(result.data)) return json({ error: "Recording access could not be checked. Try again." }, 503);
    // The RPC deliberately does not distinguish missing copies from copies this caller cannot access.
    if (result.data.length === 0) return json({ recording: null }, 200);
    if (result.data.length !== 1) return json({ error: "Recording access could not be checked. Try again." }, 503);
    const row = result.data[0];
    if (!object(row) || typeof row.call_id !== "string" || row.call_id.toLowerCase() !== callId
      || !isPrivateRecordingPath(row.path) || typeof row.variant !== "string" || !variants.has(row.variant)
      || !(row.duration_seconds === null || (typeof row.duration_seconds === "number" && Number.isInteger(row.duration_seconds) && row.duration_seconds >= 0))
      || !Array.isArray(row.muted_ranges)) {
      return json({ error: "Recording access could not be checked. Try again." }, 503);
    }
    const signed = await deps.signRecording(row.path, READYMODE_RECORDING_URL_TTL);
    if (signed.error || !object(signed.data) || typeof signed.data.signedUrl !== "string") return json({ error: "The recording could not be opened. Try again." }, 503);
    let url: URL;
    try { url = new URL(signed.data.signedUrl); }
    catch { return json({ error: "The recording could not be opened. Try again." }, 503); }
    if (url.protocol !== "https:" || url.username || url.password) return json({ error: "The recording could not be opened. Try again." }, 503);
    return json({ signedUrl: signed.data.signedUrl, expiresInSeconds: READYMODE_RECORDING_URL_TTL, variant: row.variant }, 200);
  } catch {
    return json({ error: "The recording could not be opened. Try again." }, 503);
  }
}
