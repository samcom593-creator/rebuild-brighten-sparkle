// Sign only a recording returned by the caller's existing authorized training catalog.
// Browser inputs never choose a bucket, object path, provider URL or signing lifetime.
import { hasControlCharacter, isPrivateRecordingPath } from "./private-recording-path.ts";

export const TRAINING_RECORDING_URL_TTL = 900;
type Result = { data: unknown; error: unknown };
export interface TrainingRecordingUrlDependencies {
  getUser(): Promise<{ userId: string | null; error: unknown }>;
  listRecordings(): PromiseLike<Result>;
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
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const validId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 200
  && value.trim() === value && !hasControlCharacter(value);

/** The dependency adapter may create a service client only when signRecording is reached. */
export async function handleTrainingRecordingUrl(req: Request, deps: TrainingRecordingUrlDependencies): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only." }, 405);
  if (!/^Bearer\s+\S+$/i.test(req.headers.get("Authorization") ?? "")) return json({ error: "Sign in required." }, 401);

  try {
    const auth = await deps.getUser();
    if (auth.error || typeof auth.userId !== "string" || !auth.userId.trim()) return json({ error: "Sign in required." }, 401);

    let body: unknown;
    try { body = await req.json(); }
    catch { return json({ error: "A recording ID is required." }, 400); }
    if (!object(body) || Object.keys(body).length !== 1 || !validId(body.recordingId)) {
      return json({ error: "Provide only a recording ID." }, 400);
    }

    // This must run with the same verified caller JWT, never with the service role.
    // The RPC already enforces published status, active/granted access and transcript privacy.
    const catalog = await deps.listRecordings();
    if (catalog.error || !Array.isArray(catalog.data)) return json({ error: "Recording access could not be checked. Try again." }, 503);
    const ids = new Set<string>();
    let path: string | null = null;
    for (const row of catalog.data) {
      if (!object(row) || !validId(row.id) || !isPrivateRecordingPath(row.audio_path) || ids.has(row.id)) {
        return json({ error: "Recording access could not be checked. Try again." }, 503);
      }
      ids.add(row.id);
      if (row.id === body.recordingId) path = row.audio_path;
    }
    if (path === null) return json({ error: "This recording is not available to your account." }, 404);

    const signed = await deps.signRecording(path, TRAINING_RECORDING_URL_TTL);
    if (signed.error || !object(signed.data) || typeof signed.data.signedUrl !== "string") {
      return json({ error: "The recording could not be opened. Try again." }, 503);
    }
    let url: URL;
    try { url = new URL(signed.data.signedUrl); }
    catch { return json({ error: "The recording could not be opened. Try again." }, 503); }
    if (url.protocol !== "https:" || url.username || url.password) return json({ error: "The recording could not be opened. Try again." }, 503);
    return json({ signedUrl: signed.data.signedUrl, expiresInSeconds: TRAINING_RECORDING_URL_TTL }, 200);
  } catch {
    // Do not echo tokens, signed URLs, private paths or provider errors into a response/log.
    return json({ error: "The recording could not be opened. Try again." }, 503);
  }
}
