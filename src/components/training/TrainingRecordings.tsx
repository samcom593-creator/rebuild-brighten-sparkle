// TrainingRecordings: the recorded training calls, played from our own private copy (MP-TRAINING-CENTER, 2026-11-23).
//
// These used to play straight from the old resources site: the full recording in an embedded Drive player with a
// word-for-word transcript beside it, Social Security numbers and bank details included, from a source anyone on the
// internet can read. This tab reads training_recordings_list() instead: re-cut audio in the private
// training-recordings bucket and a transcript with the same spans removed. A recording that still trips the
// database's leak test is not returned.
import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Headphones, Play, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { PrivateAudioPlayer, type PrivateAudioPlayerHandle } from "@/components/calls/PrivateAudioPlayer";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { z } from "zod";

interface Turn { t: number; speaker?: string; text: string }
interface Recording {
  id: string;
  title: string;
  presenter_id: string | null;
  presenter_name: string | null;
  topic: string | null;
  description: string | null;
  recorded_on: string | null;
  duration_seconds: number | null;
  audio_path: string;
  transcript: Turn[] | null;
}
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const recordingSchema = z.object({
  id: z.string().min(1), title: z.string().min(1), presenter_id: z.string().nullable(), presenter_name: z.string().nullable(),
  topic: z.string().nullable(), description: z.string().nullable(), recorded_on: z.string().nullable(),
  duration_seconds: z.number().finite().nonnegative().nullable(), audio_path: z.string().min(1),
  transcript: z.array(z.object({ t: z.number().finite().nonnegative(), speaker: z.string().optional(), text: z.string() })).nullable(),
});

async function fetchRecordings(): Promise<Recording[]> {
  const { data, error } = await supabase.rpc("training_recordings_list" as never);
  if (error) throw new Error("Recording access could not be verified.");
  const result = z.array(recordingSchema).safeParse(data);
  if (!result.success || new Set(result.data.map(row => row.id)).size !== result.data.length) throw new Error("The recording list could not be verified.");
  // The runtime schema requires these fields; non-strict TypeScript infers them as optional.
  return result.data as Recording[];
}

async function resolveTrainingAudio(recordingId: string) {
  // The endpoint rechecks this caller's published/redacted catalog before signing its exact path.
  const { data, error } = await supabase.functions.invoke("training-recording-url", { body: { recordingId } });
  if (error || !data || typeof data.signedUrl !== "string" || typeof data.expiresInSeconds !== "number") throw new Error("Recording access could not be verified.");
  return { signedUrl: data.signedUrl, expiresInSeconds: data.expiresInSeconds, variant: "client_data_removed" };
}
export function TrainingRecordings() {
  const { user } = useAuth();
  if (!user) return <p className="text-sm text-muted-foreground">Sign in to view training recordings.</p>;
  return <TrainingRecordingsWorkspace key={user.id} userId={user.id} />;
}

function TrainingRecordingsWorkspace({ userId }: { userId: string }) {
  const q = useQuery({ queryKey: ["training-recordings", userId], queryFn: fetchRecordings, staleTime: 5 * 60_000, gcTime: 0, retry: false, meta: { silent: true } });
  const [presenter, setPresenter] = useState("all");
  const [activeId, setActiveId] = useState<string | null>(null);
  const all = useMemo(() => q.data ?? [], [q.data]);
  const active = all.find(recording => recording.id === activeId) ?? null;
  const presenters = useMemo(() => {
    const m = new Map<string, { name: string; n: number }>();
    for (const r of all) {
      const key = r.presenter_id ?? "unknown";
      const cur = m.get(key) ?? { name: r.presenter_name ?? "Team", n: 0 };
      cur.n += 1;
      m.set(key, cur);
    }
    return Array.from(m, ([id, v]) => ({ id, ...v }));
  }, [all]);
  const list = presenter === "all" ? all : all.filter((r) => (r.presenter_id ?? "unknown") === presenter);

  if (q.isLoading) return <div className="space-y-2">{Array.from({ length: 4 }, (_, n) => <Skeleton key={`rec-sk-${n}`} className="h-16 w-full" />)}</div>;
  if (q.isError) return <div className="space-y-3"><EmptyState icon={<Headphones className="h-6 w-6" />} title="The recordings did not load" description="Recording access could not be verified." /><Button variant="outline" disabled={q.isFetching} onClick={() => void q.refetch()}>Retry recordings</Button></div>;
  if (all.length === 0) return <EmptyState icon={<Headphones className="h-6 w-6" />} title="No recordings yet" description="Recorded training calls appear here once they are cleared for the team." />;

  return (
    <div className="space-y-5">
      {presenters.length > 1 && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant={presenter === "all" ? "default" : "outline"} aria-pressed={presenter === "all"} onClick={() => setPresenter("all")}>
            Everyone<span className="ml-1.5 tabular-nums opacity-70">{all.length}</span>
          </Button>
          {presenters.map((p) => (
            <Button key={p.id} size="sm" variant={presenter === p.id ? "default" : "outline"} aria-pressed={presenter === p.id} onClick={() => setPresenter(p.id)}>
              {p.name}<span className="ml-1.5 tabular-nums opacity-70">{p.n}</span>
            </Button>
          ))}
        </div>
      )}
      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
        Client names, addresses, numbers and bank details are removed from these recordings and their transcripts.
      </p>
      <Card className="divide-y divide-border">
        {list.map((rec) => (
          <button key={rec.id} type="button" onClick={() => setActiveId(rec.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/40">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary"><Play className="h-4 w-4" /></span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold">{rec.title}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {[rec.presenter_name, rec.topic, rec.duration_seconds ? clock(rec.duration_seconds) : null].filter(Boolean).join(" · ")}
              </span>
            </span>
          </button>
        ))}
      </Card>
      <Dialog open={!!active} onOpenChange={(open) => !open && setActiveId(null)}>
        <DialogContent className="max-h-[85dvh] w-[calc(100vw-2rem)] max-w-3xl overflow-y-auto sm:w-full">
          {active && <RecordingPlayer key={active.id} rec={active} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RecordingPlayer({ rec }: { rec: Recording }) {
  const ref = useRef<PrivateAudioPlayerHandle | null>(null);
  const [now, setNow] = useState(0);
  const turns = rec.transcript ?? [];
  const current = turns.reduce((acc, t, i) => (t.t <= now ? i : acc), -1);
  const seek = (s: number) => {
    ref.current?.playFrom(Math.max(0, s - 1));
  };
  return (
    <>
      <DialogHeader>
        <DialogTitle className="pr-6 text-left">{rec.title}</DialogTitle>
        <DialogDescription className="text-left">
          {[rec.presenter_name, rec.recorded_on].filter(Boolean).join(" · ")}
          {rec.description ? ` — ${rec.description}` : ""}
        </DialogDescription>
      </DialogHeader>
      <PrivateAudioPlayer ref={ref} sourceKey={`training:${rec.id}:${rec.audio_path}`} resolveSource={() => resolveTrainingAudio(rec.id)} playOnLoad onTimeUpdate={setNow} />
      {turns.length > 0 && (
        <CardContent className="max-h-72 overflow-y-auto rounded-md border border-border p-2">
          {turns.map((u, i) => (
            <button
              key={`${u.t}-${u.text.slice(0, 24)}`}
              type="button"
              onClick={() => seek(u.t)}
              className={cn("flex w-full gap-3 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/40", i === current && "bg-primary/10")}
            >
              <span className="w-11 shrink-0 pt-0.5 text-xs tabular-nums text-muted-foreground">{clock(u.t)}</span>
              {u.speaker && <span className="shrink-0 pt-0.5 text-[11px] font-bold uppercase text-primary">{u.speaker}</span>}
              <span className="leading-relaxed text-muted-foreground">{u.text}</span>
            </button>
          ))}
        </CardContent>
      )}
    </>
  );
}

export default TrainingRecordings;
