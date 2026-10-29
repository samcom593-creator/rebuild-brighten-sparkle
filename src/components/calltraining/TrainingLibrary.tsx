// TrainingLibrary: the team's view of Call Training (MP-310, 2026-10-28).
//
// Sam: "they can't hear it ... no one's gonna sit there and read 100 different calls." Every agent gets the calls worth
// learning from (graded great or 70+, or an objection the agent turned, with no compliance flag), the recording on the
// page, and one-tap snippets at each moment. Spoken numbers are muted in the team's copy. call_training_library()
// returns training fields only, never client contact data or coaching notes, and the audio policy allows only the
// muted copy of a training call.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { GraduationCap, Star } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/ui/page-header";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { CallAudioPlayer } from "@/components/calls/CallAudioPlayer";
import { momentsFrom } from "@/lib/callAudio";
import { dispositionLabel } from "@/lib/readymodeDispositions";
import { cn } from "@/lib/utils";

interface LibraryRow {
  call_id: string;
  call_started_at: string | null;
  agent_name: string | null;
  disposition: string | null;
  overall_score: number | null;
  great_call: boolean | null;
  tactics: string[] | null;
  strengths: string[] | null;
  objection_moments: unknown;
  key_quotes: unknown;
  summary: string | null;
}
interface Turn { t: string; objection: string; response: string; technique: string; worked: boolean }
type ViewKey = "great" | "objections" | "all";
const VIEWS: Array<{ key: ViewKey; label: string }> = [
  { key: "great", label: "Great calls" },
  { key: "objections", label: "Objections turned" },
  { key: "all", label: "Every training call" },
];

function turns(v: unknown): Turn[] {
  if (!Array.isArray(v)) return [];
  return v.filter((m): m is Turn => !!m && typeof m === "object" && typeof (m as Turn).objection === "string" && typeof (m as Turn).t === "string");
}

async function fetchLibrary(): Promise<LibraryRow[]> {
  const { data, error } = await supabase.rpc("call_training_library" as never);
  if (error) throw new Error((error as { message?: string }).message ?? "The training library did not load.");
  return (Array.isArray(data) ? data : []) as LibraryRow[];
}

export function TrainingLibrary() {
  const q = useQuery({ queryKey: ["call-training-library"], queryFn: fetchLibrary, staleTime: 5 * 60_000 });
  const [view, setView] = useState<ViewKey>("great");
  const [openId, setOpenId] = useState<string | null>(null);
  const rows = useMemo(
    () => (q.data ?? []).filter((r) => (view === "all" ? true : view === "great" ? !!r.great_call : turns(r.objection_moments).some((m) => m.worked))),
    [q.data, view],
  );
  return (
    <div className="space-y-6">
      <PageHeader title="Call Training" subtitle="Hear the calls worth learning from. Tap a moment to play that part of the call." />
      <div className="flex flex-wrap gap-2">
        {VIEWS.map((v) => (
          <Button key={v.key} size="sm" variant={view === v.key ? "default" : "outline"} aria-pressed={view === v.key} onClick={() => setView(v.key)}>{v.label}</Button>
        ))}
      </div>
      {q.isLoading ? (
        <div className="space-y-2">{Array.from({ length: 4 }, (_, n) => <Skeleton key={`lib-sk-${n}`} className="h-20 w-full" />)}</div>
      ) : q.isError ? (
        <EmptyState icon={<GraduationCap className="h-6 w-6" />} title="The training library did not load" description={(q.error as Error).message} />
      ) : rows.length === 0 ? (
        <EmptyState icon={<GraduationCap className="h-6 w-6" />} title="No calls here yet" description="Training calls appear as the dialer bot grades them." />
      ) : (
        <div className="space-y-2">
          {rows.map((r) => {
            const open = openId === r.call_id;
            const ts = turns(r.objection_moments);
            return (
              <GlassCard key={r.call_id} className={cn("p-0", r.great_call && "border-amber-500/40")}>
                <button type="button" onClick={() => setOpenId(open ? null : r.call_id)} aria-expanded={open} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left">
                  <span className="w-12 text-2xl font-bold tabular-nums">{r.overall_score ?? ""}</span>
                  {r.great_call && <Badge className="border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-200"><Star className="mr-1 h-3 w-3" /> Great call</Badge>}
                  <span className="font-medium">{r.agent_name || "Agent"}</span>
                  <span className="text-sm text-muted-foreground">
                    {r.call_started_at ? new Date(r.call_started_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : ""} · {dispositionLabel(r.disposition)}
                  </span>
                  {r.summary && <p className="w-full text-sm text-muted-foreground">{r.summary}</p>}
                </button>
                {open && (
                  <div className="space-y-3 border-t border-border/60 px-4 py-3 text-sm">
                    <CallAudioPlayer callId={r.call_id} moments={[...ts.map((m) => ({ t: m.t, label: m.objection })), ...momentsFrom(r.key_quotes)]} />
                    {ts.length > 0 && (
                      <ul className="space-y-2">
                        {ts.map((m) => (
                          <li key={`${m.t}-${m.objection}`} className="rounded-md border border-border/60 bg-background/40 p-2">
                            <p><span className="font-mono text-xs text-muted-foreground">[{m.t}]</span> <span className="font-medium">Client:</span> {m.objection}</p>
                            <p className="mt-1"><span className="font-medium">Agent:</span> {m.response}</p>
                            <p className="mt-1 text-xs text-muted-foreground">{m.technique} · {m.worked ? "moved forward" : "did not land"}</p>
                          </li>
                        ))}
                      </ul>
                    )}
                    {(r.tactics ?? []).length > 0 && <p><span className="font-semibold">Worth copying:</span> {(r.tactics ?? []).join(" · ")}</p>}
                    {(r.strengths ?? []).length > 0 && <ul className="list-disc space-y-0.5 pl-5">{(r.strengths ?? []).map((s) => <li key={s}>{s}</li>)}</ul>}
                  </div>
                )}
              </GlassCard>
            );
          })}
        </div>
      )}
    </div>
  );
}
