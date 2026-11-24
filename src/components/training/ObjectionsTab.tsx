// ObjectionsTab: every objection an agent on the team turned, grouped by what the client said (MP-TRAINING-CENTER).
//
// Sam: keep "everything needed inside of the call in terms of objections". An agent facing "I can't afford it" should
// not have to sit through 30-minute calls to find the answer: pick the objection, read what was said back, hear that
// 45 seconds. call_training_objections() reads the team copy only, so no client data reaches this page.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MessageCircleQuestion, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { CallAudioPlayer } from "@/components/calls/CallAudioPlayer";

interface ObjectionRow {
  call_id: string;
  agent_name: string | null;
  call_day: string | null;
  overall_score: number | null;
  great_call: boolean | null;
  category: string;
  t: string;
  objection: string;
  response: string;
  technique: string | null;
}
/** Order = how often a new agent hears it on the phone. Keys match fn_objection_category(). */
const CATEGORIES: Array<{ key: string; label: string }> = [
  { key: "price", label: "Can't afford it" },
  { key: "think", label: "Let me think / call me back" },
  { key: "spouse", label: "Need to ask my family" },
  { key: "ssn", label: "Social Security number" },
  { key: "bank", label: "Bank information" },
  { key: "trust", label: "Is this a scam?" },
  { key: "covered", label: "Already have coverage" },
  { key: "not_interested", label: "Not interested" },
  { key: "other", label: "Other" },
];

async function fetchObjections(): Promise<ObjectionRow[]> {
  const { data, error } = await supabase.rpc("call_training_objections" as never);
  if (error) throw new Error((error as { message?: string }).message ?? "The objection library did not load.");
  return (Array.isArray(data) ? data : []) as ObjectionRow[];
}

export function ObjectionsTab() {
  const q = useQuery({ queryKey: ["call-training-objections"], queryFn: fetchObjections, staleTime: 5 * 60_000 });
  const [category, setCategory] = useState<string>("price");
  const [search, setSearch] = useState("");
  const [playing, setPlaying] = useState<string | null>(null);
  const all = useMemo(() => q.data ?? [], [q.data]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of all) c[r.category] = (c[r.category] ?? 0) + 1;
    return c;
  }, [all]);
  const present = CATEGORIES.filter((c) => (counts[c.key] ?? 0) > 0);
  const active = present.some((c) => c.key === category) ? category : present[0]?.key ?? "price";
  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (s) return all.filter((r) => [r.objection, r.response, r.technique, r.agent_name].some((v) => (v ?? "").toLowerCase().includes(s)));
    return all.filter((r) => r.category === active);
  }, [all, active, search]);

  if (q.isLoading) return <div className="space-y-2">{Array.from({ length: 4 }, (_, n) => <Skeleton key={`obj-sk-${n}`} className="h-24 w-full" />)}</div>;
  if (q.isError) return <EmptyState icon={<MessageCircleQuestion className="h-6 w-6" />} title="The objection library did not load" description={(q.error as Error).message} />;
  if (all.length === 0) return <EmptyState icon={<MessageCircleQuestion className="h-6 w-6" />} title="No objections yet" description="Turned objections appear here as calls are graded and cleared for the team." />;

  return (
    <div className="space-y-5">
      <div className="relative w-full sm:max-w-sm">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search what the client said" aria-label="Search objections" className="h-9 pl-8" />
      </div>
      {!search.trim() && (
        <div className="flex flex-wrap gap-2">
          {present.map((c) => (
            <Button key={c.key} size="sm" variant={active === c.key ? "default" : "outline"} aria-pressed={active === c.key} onClick={() => setCategory(c.key)}>
              {c.label}
              <span className="ml-1.5 tabular-nums opacity-70">{counts[c.key]}</span>
            </Button>
          ))}
        </div>
      )}
      {rows.length === 0 ? (
        <EmptyState icon={<MessageCircleQuestion className="h-6 w-6" />} title="Nothing matches" description="Try a different word." />
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => {
            const id = `${r.call_id}|${r.t}|${r.objection}`;
            return (
              <li key={id}>
                <GlassCard className="space-y-2 p-4 text-sm">
                  <p><span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Client</span><br />{r.objection}</p>
                  <p><span className="text-xs font-semibold uppercase tracking-wide text-primary">What worked</span><br />{r.response}</p>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    {r.technique && <Badge variant="outline" className="font-normal">{r.technique}</Badge>}
                    <span>{r.agent_name || "Agent"}</span>
                    {playing !== id && (
                      <Button type="button" size="sm" variant="outline" className="ml-auto h-8" onClick={() => setPlaying(id)}>
                        Hear it
                      </Button>
                    )}
                  </div>
                  {playing === id && <CallAudioPlayer callId={r.call_id} moments={[{ t: r.t, label: "Play this objection" }]} />}
                </GlassCard>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default ObjectionsTab;
