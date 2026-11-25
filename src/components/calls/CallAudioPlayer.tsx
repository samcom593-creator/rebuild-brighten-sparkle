// ReadyMode links require a separate provider session. Resolve the caller's authorized private copy instead.
import { supabase } from "@/integrations/supabase/client";
import { PrivateAudioPlayer, type PrivateAudioSource } from "@/components/calls/PrivateAudioPlayer";
import type { AudioMoment } from "@/lib/callAudio";

async function resolveCallAudio(callId: string): Promise<PrivateAudioSource | null> {
  const { data, error } = await supabase.functions.invoke("readymode-recording-url", { body: { callId } });
  if (error || !data || typeof data !== "object") throw new Error("Recording access could not be verified.");
  if (data.recording === null && Object.keys(data).length === 1) return null;
  if (typeof data.signedUrl !== "string" || typeof data.expiresInSeconds !== "number" ||
    !["full", "numbers_muted", "client_data_removed"].includes(data.variant)) throw new Error("Recording access could not be verified.");
  return { signedUrl: data.signedUrl, expiresInSeconds: data.expiresInSeconds, variant: data.variant };
}

export function CallAudioPlayer({ callId, moments = [], compact = false, onPlay }: { callId: string; moments?: AudioMoment[]; compact?: boolean; onPlay?: () => void }) {
  if (!callId) return <p className="text-xs text-muted-foreground">This record has no linked call recording.</p>;
  return <PrivateAudioPlayer sourceKey={`readymode:${callId}`} resolveSource={() => resolveCallAudio(callId)} callId={callId} moments={moments} compact={compact} playLabel="Play call" emptyMessage="This call's recording is not published for your account yet." onPlay={onPlay} />;
}
