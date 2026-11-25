// ReadyMode links require a separate provider session. Resolve the caller's authorized private copy instead.
import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PrivateAudioPlayer, type PrivateAudioSource } from "@/components/calls/PrivateAudioPlayer";
import type { AudioMoment } from "@/lib/callAudio";
import { useAuth } from "@/hooks/useAuth";
import { useCallAudioAvailability } from "@/hooks/useCallAudioAvailability";
import { Button } from "@/components/ui/button";

async function resolveCallAudio(callId: string, signal: AbortSignal): Promise<PrivateAudioSource | null> {
  const { data, error } = await supabase.functions.invoke("readymode-recording-url", { body: { callId }, signal });
  if (error || !data || typeof data !== "object") throw new Error("Recording access could not be verified.");
  if (data.recording === null && Object.keys(data).length === 1) return null;
  if (typeof data.signedUrl !== "string" || typeof data.expiresInSeconds !== "number" ||
    !["full", "numbers_muted", "client_data_removed"].includes(data.variant)) throw new Error("Recording access could not be verified.");
  return { signedUrl: data.signedUrl, expiresInSeconds: data.expiresInSeconds, variant: data.variant };
}

interface Props { callId: string; moments?: AudioMoment[]; compact?: boolean; onPlay?: () => void }
export function CallAudioPlayer(props: Props) {
  const { user, isLoading } = useAuth();
  if (isLoading) return <p role="status" className="text-sm text-muted-foreground">Checking recording access…</p>;
  if (!user) return <p className="text-sm text-muted-foreground">Sign in to play this recording.</p>;
  return <AvailableCallAudioPlayer key={`${user.id}:${props.callId}`} {...props} />;
}

function AvailableCallAudioPlayer({ callId, moments = [], compact = false, onPlay }: Props) {
  const availability = useCallAudioAvailability(callId);
  const pendingSeek = useRef<number | null>(null);
  useEffect(() => {
    if (!availability.isPending) {
      const seconds = pendingSeek.current;
      pendingSeek.current = null;
      if (availability.data === true && seconds !== null) {
        // The authorized child has now mounted and can preserve snippet/seek behavior.
        window.dispatchEvent(new CustomEvent("call-audio-seek", { detail: { callId, seconds } }));
      }
      return;
    }
    const seek = (event: Event) => {
      const detail = (event as CustomEvent<{ callId?: string; seconds?: number; claimed?: boolean }>).detail;
      if (detail?.callId !== callId || detail.claimed || typeof detail.seconds !== "number" || !Number.isFinite(detail.seconds)) return;
      detail.claimed = true;
      pendingSeek.current = detail.seconds;
    };
    window.addEventListener("call-audio-seek", seek);
    return () => window.removeEventListener("call-audio-seek", seek);
  }, [availability.data, availability.isPending, callId]);
  if (!callId) return <p className="text-xs text-muted-foreground">This record has no linked call recording.</p>;
  if (availability.isPending) return <p role="status" className="text-sm text-muted-foreground">Checking recording availability…</p>;
  if (availability.isError || !availability.data) return <div className="space-y-2">
    <p role={availability.isError ? "alert" : "status"} className="text-sm text-muted-foreground">{availability.isError ? "Recording availability could not be checked. Retry to verify access." : "This call's recording is not published for your account yet."}</p>
    <Button type="button" size="sm" variant="outline" disabled={availability.isFetching} onClick={() => void availability.refetch()}>Check recording again</Button>
  </div>;
  return <PrivateAudioPlayer sourceKey={`readymode:${callId}`} resolveSource={signal => resolveCallAudio(callId, signal)} callId={callId} moments={moments} compact={compact} playLabel="Play call" emptyMessage="This call's recording is not published for your account yet." onPlay={onPlay} />;
}
