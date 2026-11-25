import { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Play } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toSeconds, type AudioMoment } from "@/lib/callAudio";

export type PrivateAudioSource = {
  bucket: "readymode-audio" | "call-recordings"; path: string; variant?: string;
} | {
  signedUrl: string; expiresInSeconds: number; variant?: string;
};
export interface PrivateAudioPlayerHandle { playFrom: (seconds: number) => void }
interface Props {
  sourceKey: string;
  resolveSource: () => Promise<PrivateAudioSource | null>;
  compact?: boolean;
  playOnLoad?: boolean;
  playLabel?: string;
  emptyMessage?: string;
  callId?: string;
  moments?: AudioMoment[];
  onPlay?: () => void;
  onTimeUpdate?: (seconds: number) => void;
}
type Playback = { seconds: number; play: boolean; stopAt: number | null };
const URL_LIFETIME_SECONDS = 3600;
const REFRESH_BEFORE_EXPIRY_MS = 30_000;
const FAILED_MEDIA = "This recording could not play. Retry the recording to check its availability again.";
const FAILED_ACCESS = "The recording could not be opened for this account. Retry, or ask an administrator to check recording access.";
const RECORDING_PLAY_EVENT = "private-recording-play";

/** URLs are signed under the current login; an account change removes the previous player immediately. */
export const PrivateAudioPlayer = forwardRef<PrivateAudioPlayerHandle, Props>(function PrivateAudioPlayer(props, ref) {
  const { user, isLoading } = useAuth();
  if (isLoading) return <p role="status" className="text-sm text-muted-foreground">Checking recording access…</p>;
  if (!user) return <p className="text-sm text-muted-foreground">Sign in to play this recording.</p>;
  return <RecordingPlayback key={`${user.id}:${props.sourceKey}`} {...props} userId={user.id} ref={ref} />;
});

/** Playback for an already-authorized source. Product callers use PrivateAudioPlayer; isolated QA can supply synthetic media. */
export const RecordingPlayback = forwardRef<PrivateAudioPlayerHandle, Props & { userId: string }>(function RecordingPlayback({
  sourceKey, resolveSource, userId, compact = false, playOnLoad = false, playLabel = "Play recording", emptyMessage = "This recording is not available to your account yet.",
  callId, moments = [], onPlay, onTimeUpdate,
}, forwardedRef) {
  const instanceId = useId();
  const [armed, setArmed] = useState(!compact);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [revision, setRevision] = useState(0);
  const audio = useRef<HTMLAudioElement | null>(null);
  const setAudio = useCallback((element: HTMLAudioElement | null) => {
    if (audio.current && audio.current !== element) audio.current.pause();
    audio.current = element;
  }, []);
  const pending = useRef<Playback | null>(playOnLoad ? { seconds: 0, play: true, stopAt: null } : null);
  const stopAt = useRef<number | null>(null);
  const scriptedSeek = useRef<number | null>(null);
  const lastPosition = useRef(0);
  const intendsPlayback = useRef(false);
  const refreshing = useRef(false);
  const automaticRetries = useRef(0);
  const playAttempt = useRef(0);
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; playAttempt.current += 1; }; }, []);

  const q = useQuery({
    // Separate instances can show the same call. Renewing one must not replace the other's paused source/position.
    queryKey: ["private-recording", userId, sourceKey, instanceId], enabled: armed,
    // Focus/reconnect must not replace src and reset a playing call. Expiry is handled on playback or failure.
    staleTime: Infinity, gcTime: 0, retry: false,
    refetchOnWindowFocus: false, refetchOnReconnect: false, refetchOnMount: false,
    // Media URLs and backend signing details must not enter general query telemetry.
    meta: { silent: true },
    queryFn: async ({ signal }) => {
      try {
        const source = await resolveSource();
        if (signal.aborted) throw new Error(FAILED_ACCESS);
        if (!source) return null;
        let url: string;
        let expiresInSeconds: number;
        if ("signedUrl" in source) {
          url = source.signedUrl;
          expiresInSeconds = source.expiresInSeconds;
        } else {
          if (!source.path?.trim() || /^(?:https?:)?\/\//i.test(source.path)) throw new Error(FAILED_ACCESS);
          const signed = await supabase.storage.from(source.bucket).createSignedUrl(source.path, URL_LIFETIME_SECONDS);
          if (signed.error || !signed.data?.signedUrl) throw new Error(FAILED_ACCESS);
          url = signed.data.signedUrl;
          expiresInSeconds = URL_LIFETIME_SECONDS;
        }
        if (signal.aborted || !Number.isFinite(expiresInSeconds) || expiresInSeconds <= 0 || expiresInSeconds > URL_LIFETIME_SECONDS) throw new Error(FAILED_ACCESS);
        const parsed = new URL(url);
        if (!["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error(FAILED_ACCESS);
        return { url, variant: source.variant, expiresAt: Date.now() + expiresInSeconds * 1000 };
      } catch {
        // Errors can contain private paths or signed URLs; keep UI and query telemetry generic.
        throw new Error(FAILED_ACCESS);
      }
    },
  });
  const { refetch } = q;

  const play = useCallback((element: HTMLAudioElement) => {
    const attempt = ++playAttempt.current;
    setBlocked(false);
    setMediaError(null);
    intendsPlayback.current = true;
    const failed = (error: unknown) => {
      if (!live.current || audio.current !== element || attempt !== playAttempt.current) return;
      if ((error as { name?: string })?.name === "AbortError") return;
      if ((error as { name?: string })?.name === "NotAllowedError") {
        setBlocked(true);
        setMediaError("Your browser paused playback. Press Play recording to listen.");
      } else setMediaError(FAILED_MEDIA);
    };
    try { void Promise.resolve(element.play()).catch(failed); }
    catch (error) { failed(error); }
  }, []);

  const snapshot = useCallback((): Playback => {
    const position = audio.current?.currentTime;
    return { seconds: typeof position === "number" && Number.isFinite(position) && position > 0 ? position : lastPosition.current, play: intendsPlayback.current, stopAt: stopAt.current };
  }, []);

  const renew = useCallback(async (reason: "manual" | "expired" | "media", resume?: Playback) => {
    if (refreshing.current || !live.current) return;
    if (reason === "media" && automaticRetries.current >= 1) { setMediaError(FAILED_MEDIA); return; }
    if (reason === "manual") automaticRetries.current = 0;
    if (reason === "media") automaticRetries.current += 1;
    refreshing.current = true;
    playAttempt.current += 1;
    const element = audio.current;
    pending.current = resume ?? pending.current ?? snapshot();
    element?.pause();
    setBlocked(false); setMediaError(null);
    try {
      const result = await refetch();
      if (live.current && !result.isError) setRevision((value) => value + 1);
    } finally { refreshing.current = false; }
  }, [refetch, snapshot]);

  const applyPlayback = useCallback((element: HTMLAudioElement, request: Playback) => {
    const position = Number.isFinite(element.duration) && element.duration > 0
      ? Math.min(request.seconds, Math.max(0, element.duration - 0.01)) : request.seconds;
    scriptedSeek.current = position;
    lastPosition.current = position;
    stopAt.current = request.stopAt;
    try { element.currentTime = position; }
    catch { setMediaError("That point in the recording is not ready. Retry the recording."); return; }
    if (request.play) play(element);
  }, [play]);

  const requestPlayback = useCallback((seconds: number, snippet = false) => {
    if (!Number.isFinite(seconds)) return;
    const request = { seconds: Math.max(0, seconds), play: true, stopAt: snippet ? Math.max(0, seconds) + 45 : null };
    pending.current = request;
    setMediaError(null);
    if (!armed) { setArmed(true); return; }
    const element = audio.current;
    if (!element || !q.data || refreshing.current) return;
    if (Date.now() >= q.data.expiresAt - REFRESH_BEFORE_EXPIRY_MS) { void renew("expired", request); return; }
    if (element.readyState < 1) { element.load(); return; }
    pending.current = null;
    applyPlayback(element, request);
  }, [applyPlayback, armed, q.data, renew]);
  useImperativeHandle(forwardedRef, () => ({ playFrom: (seconds) => requestPlayback(seconds) }), [requestPlayback]);

  useEffect(() => {
    const pauseOther = (event: Event) => {
      const playing = (event as CustomEvent<{ element?: HTMLAudioElement }>).detail?.element;
      if (!playing || playing === audio.current) return;
      intendsPlayback.current = false;
      if (pending.current) pending.current = { ...pending.current, play: false };
      audio.current?.pause();
    };
    window.addEventListener(RECORDING_PLAY_EVENT, pauseOther);
    return () => window.removeEventListener(RECORDING_PLAY_EVENT, pauseOther);
  }, []);

  useEffect(() => {
    if (!callId) return;
    const seek = (event: Event) => {
      const detail = (event as CustomEvent<{ callId?: string; seconds?: number; claimed?: boolean }>).detail;
      if (detail?.callId === callId && !detail.claimed && typeof detail.seconds === "number" && Number.isFinite(detail.seconds)) {
        detail.claimed = true;
        requestPlayback(Math.max(0, detail.seconds - 3), true);
      }
    };
    window.addEventListener("call-audio-seek", seek);
    return () => window.removeEventListener("call-audio-seek", seek);
  }, [callId, requestPlayback]);

  if (!armed) return <Button type="button" size="sm" variant="outline" onClick={() => requestPlayback(0)}><Play className="mr-1 h-3.5 w-3.5" aria-hidden="true" />{playLabel}</Button>;
  if (q.isPending) return <p role="status" className="text-sm text-muted-foreground">Loading the recording…</p>;
  if (q.isError || !q.data) return <div className="space-y-2"><p role={q.isError ? "alert" : "status"} className="text-sm text-muted-foreground">{q.isError ? "The recording did not load. Recording access or the saved file may be unavailable." : emptyMessage}</p><Button type="button" size="sm" variant="outline" disabled={q.isFetching} onClick={() => void renew("manual")}>Retry recording</Button></div>;
  const placed = moments.map(moment => ({ ...moment, seconds: toSeconds(moment.t) })).filter((moment): moment is AudioMoment & { seconds: number } => moment.seconds !== null && Number.isFinite(moment.seconds));
  return <div className="w-full min-w-0 space-y-2">
    <audio key={revision} ref={setAudio} aria-label="Call recording" controls preload="metadata" src={q.data.url} className="w-full"
      onLoadedMetadata={(event) => {
        const request = pending.current;
        if (!request || refreshing.current) return;
        pending.current = null;
        applyPlayback(event.currentTarget, request);
      }}
      onError={(event) => {
        if (event.currentTarget.error?.code === 1 || refreshing.current) return;
        void renew("media", pending.current ?? snapshot());
      }}
      onPlay={(event) => {
        intendsPlayback.current = true;
        if (Date.now() >= q.data.expiresAt - REFRESH_BEFORE_EXPIRY_MS) {
          void renew("expired", { ...snapshot(), play: true }); return;
        }
        lastPosition.current = event.currentTarget.currentTime;
        window.dispatchEvent(new CustomEvent(RECORDING_PLAY_EVENT, { detail: { element: event.currentTarget } }));
      }}
      onPlaying={() => { if (!refreshing.current) { setMediaError(null); setBlocked(false); onPlay?.(); } }}
      onPause={(event) => { if (!refreshing.current && !event.currentTarget.error) intendsPlayback.current = false; }}
      onEnded={() => { intendsPlayback.current = false; stopAt.current = null; }}
      onTimeUpdate={(event) => {
        const element = event.currentTarget;
        if (!pending.current) lastPosition.current = element.currentTime;
        onTimeUpdate?.(element.currentTime);
        if (stopAt.current !== null && element.currentTime >= stopAt.current) { element.pause(); stopAt.current = null; }
      }}
      onSeeking={event => {
        if (scriptedSeek.current !== null && Math.abs(event.currentTarget.currentTime - scriptedSeek.current) < 0.1) return;
        stopAt.current = null;
        lastPosition.current = event.currentTarget.currentTime;
      }}
      onSeeked={() => { scriptedSeek.current = null; }}
    />
    {q.isFetching && <p role="status" className="text-sm text-muted-foreground">Refreshing recording access…</p>}
    {mediaError && <div className="space-y-2"><p role="alert" className="text-sm text-destructive">{mediaError}</p><Button type="button" size="sm" variant="outline" disabled={q.isFetching} onClick={() => blocked && audio.current ? play(audio.current) : void renew("manual")}>{blocked ? "Play recording" : "Retry recording"}</Button></div>}
    {q.data.variant === "numbers_muted" && <p className="text-sm text-muted-foreground">Spoken numbers are muted for privacy.</p>}
    {q.data.variant === "client_data_removed" && <p className="text-sm text-muted-foreground">Client names, addresses and numbers are muted. Silent gaps are normal.</p>}
    {placed.length > 0 && <div className="flex flex-wrap gap-1.5" aria-label="Play a moment">{placed.map(moment => <Button key={`${moment.t}|${moment.label}`} type="button" size="sm" variant="outline" className="h-8 px-2 text-xs" onClick={() => requestPlayback(Math.max(0, moment.seconds - 3), true)}><Play className="mr-1 h-3 w-3" aria-hidden="true" /><span className="font-mono">{moment.t}</span><span className="ml-1 max-w-[16rem] truncate">{moment.label}</span></Button>)}</div>}
  </div>;
});
