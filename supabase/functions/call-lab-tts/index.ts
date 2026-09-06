// call-lab-tts: the prospect's voice. Streams ElevenLabs audio (turbo model,
// low-latency mode, natural voice settings) behind a hard monthly cap so the
// pay-as-you-go tier can never be overrun by practice. 204 + x-tts-fallback
// tells the browser to speak the line itself.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { corsHeaders, errorResponse } from "../_shared/cors.ts";
import { AuthError, requireAuth } from "../_shared/auth.ts";
import { loadOwnedSession } from "../_shared/call-lab/session.ts";

type Quota = { used: number; limit: number; at: number };
let quota: Quota | null = null;
const fallback = () => new Response(null, { status: 204, headers: { ...corsHeaders, "x-tts-fallback": "browser" } });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);
  try {
    const auth = await requireAuth(req);
    const body = (await req.json().catch(() => ({}))) as { sessionId?: string; text?: string; voiceId?: string };
    const text = String(body.text ?? "").trim().slice(0, 900);
    if (!body.sessionId || !text) return errorResponse("sessionId and text are required", 400, "invalid_request");
    await loadOwnedSession(auth.serviceClient, auth.userId, String(body.sessionId));
    const { data: setting } = await auth.serviceClient.from("system_settings").select("value").eq("key", "elevenlabs_api_key").maybeSingle();
    const key = String((setting as { value?: string } | null)?.value ?? "").trim();
    if (key.length < 10) return fallback();
    if (!quota || Date.now() - quota.at > 10 * 60_000) {
      try {
        const r = await fetch("https://api.elevenlabs.io/v1/user/subscription", { headers: { "xi-api-key": key }, signal: AbortSignal.timeout(6000) });
        if (r.ok) { const j = await r.json() as { character_count: number; character_limit: number }; quota = { used: j.character_count, limit: j.character_limit, at: Date.now() }; }
      } catch { /* empty-catch-allow:a-failed-usagecounter-read-keeps-the-last (a failed usage-counter read keeps the last verdict; the cap is re-read next call) */ }
    }
    if (!quota) return fallback();
    const month = new Date().toISOString().slice(0, 7);
    const usageKey = `elevenlabs_usage_${month}`;
    const { data: u } = await auth.serviceClient.from("system_settings").select("value").eq("key", usageKey).maybeSingle();
    const localUsed = Number((u as { value?: string } | null)?.value ?? 0) || 0;
    const remaining = quota.limit - Math.max(quota.used, localUsed);
    if (remaining < text.length + 300 || remaining < quota.limit * 0.1) return fallback();
    const voice = (body.voiceId && /^[A-Za-z0-9]{10,40}$/.test(body.voiceId)) ? body.voiceId : "pqHfZKP75CvOlQylNhV4";
    const upstream = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}/stream?output_format=mp3_44100_128&optimize_streaming_latency=3`, {
      method: "POST", headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({ text, model_id: "eleven_turbo_v2_5", voice_settings: { stability: 0.42, similarity_boost: 0.8, style: 0.35, use_speaker_boost: true } }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!upstream.ok || !upstream.body) { console.warn(JSON.stringify({ fn: "call-lab-tts", status: upstream.status })); return fallback(); }
    await auth.serviceClient.from("system_settings").upsert({ key: usageKey, value: String(localUsed + text.length) }, { onConflict: "key" });
    quota.used += text.length;
    return new Response(upstream.body, { status: 200, headers: { ...corsHeaders, "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof AuthError) return errorResponse(err.message, err.status, "unauthorized");
    const status = (err as { status?: number }).status ?? 500;
    if (status !== 500) return errorResponse((err as Error).message, status, "refused");
    console.error(JSON.stringify({ fn: "call-lab-tts", error: err instanceof Error ? err.message.slice(0, 200) : String(err) }));
    return fallback();
  }
});
