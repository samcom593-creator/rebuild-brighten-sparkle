// CallAudioPlayer: plays a ReadyMode call on the site instead of linking to ReadyMode (MP-310, 2026-10-28).
//
// Sam: "use a downloaded call over just a link to ReadyMode ... they can't hear it." A ReadyMode recording link opens
// only for whoever holds the ReadyMode login, and ReadyMode allows one session per login, so nobody else could play a
// call. The bot publishes each downloaded recording to the private readymode-audio bucket (publish-call-audio.py): a
// copy with spoken digits muted for the team, and an unmuted sold-call copy for Sam and Aisha. call_audio_for() picks
// the file this viewer may play and the storage policy enforces the same rule. A moment button plays a short snippet.
import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Play } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toSeconds, type AudioMoment } from "@/lib/callAudio";

interface AudioRow { call_id: string; path: string; variant: string; duration_seconds: number | null }
const SNIPPET_SECONDS = 45;

async function fetchAudio(callId: string): Promise<{ url: string; variant: string } | null> {
  const { data, error } = await supabase.rpc("call_audio_for" as never, { p_call_ids: [callId] } as never);
  if (error) throw new Error((error as { message?: string }).message ?? "The recording lookup failed.");
  const rows = data as unknown as AudioRow[] | null;
  const row = (Array.isArray(rows) ? rows[0] : null) ?? null;
  if (!row) return null;
  const signed = await supabase.storage.from("readymode-audio").createSignedUrl(row.path, 3600);
  if (signed.error || !signed.data?.signedUrl) throw new Error(signed.error?.message ?? "The recording could not be opened.");
  return { url: signed.data.signedUrl, variant: row.variant };
}

export function CallAudioPlayer({ callId, moments = [], compact = false }: { callId: string; moments?: AudioMoment[]; compact?: boolean }) {
  const [armed, setArmed] = useState(!compact);
  const q = useQuery({ queryKey: ["call-audio", callId], queryFn: () => fetchAudio(callId), enabled: armed && !!callId, staleTime: 50 * 60_000 });
  const ref = useRef<HTMLAudioElement | null>(null);
  const stopAt = useRef<number | null>(null);

  const playFrom = (seconds: number) => {
    const a = ref.current;
    if (!a) return;
    const start = Math.max(0, seconds - 3);
    const go = () => {
      a.currentTime = start;
      stopAt.current = start + SNIPPET_SECONDS;
      void a.play();
    };
    if (a.readyState < 1) {
      a.addEventListener("loadedmetadata", go, { once: true });
      a.load();
    } else go();
  };

  if (!armed) {
    return (
      <Button type="button" size="sm" variant="outline" onClick={() => setArmed(true)}>
        <Play className="mr-1 h-3.5 w-3.5" /> Play call
      </Button>
    );
  }
  if (q.isLoading) return <p className="text-xs text-muted-foreground">Loading the recording…</p>;
  if (q.isError) return <p className="text-xs text-rose-700 dark:text-rose-300">The recording did not load: {(q.error as Error).message}</p>;
  if (!q.data) return <p className="text-xs text-muted-foreground">This call's recording is not on the site yet.</p>;
  const placed = moments.map((m) => ({ ...m, s: toSeconds(m.t) })).filter((m): m is AudioMoment & { s: number } => m.s != null);
  return (
    <div className="space-y-2">
      <audio
        ref={ref}
        controls
        preload="metadata"
        src={q.data.url}
        className="w-full"
        onTimeUpdate={(e) => {
          if (stopAt.current != null && e.currentTarget.currentTime >= stopAt.current) {
            e.currentTarget.pause();
            stopAt.current = null;
          }
        }}
        onSeeking={() => { stopAt.current = null; }}
      />
      {q.data.variant === "numbers_muted" && <p className="text-xs text-muted-foreground">Spoken numbers are muted for privacy.</p>}
      {placed.length > 0 && (
        <div className="flex flex-wrap gap-1.5" aria-label="Play a moment">
          {placed.map((m) => (
            <Button key={`${m.t}|${m.label}`} type="button" size="sm" variant="outline" className="h-8 px-2 text-xs" onClick={() => playFrom(m.s)}>
              <Play className="mr-1 h-3 w-3" />
              <span className="font-mono">{m.t}</span>
              <span className="ml-1 max-w-[16rem] truncate">{m.label}</span>
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
