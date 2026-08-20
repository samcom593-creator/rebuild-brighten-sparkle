import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Lightbulb, ArrowUpRight, Flame, Plus, RefreshCw, Crown } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow, parseISO } from "date-fns";

/**
 * ContentWheel Module 02 — Ideation Rolodex
 * 5 demand sources → ranked backlog. Doctrine Law 01: every idea has pillar + dogma + audience.
 * Live data from cw_ideas (joined with cw_pillars + cw_dogmas).
 */
type IdeaRow = {
  id: string; title: string; body: string | null;
  demand_source: string; demand_evidence: string | null;
  audience: "icp" | "nurture"; pillar_id: string; dogma_id: string;
  status: string; score: number | null;
  created_at: string;
  cw_pillars: { code: string; name: string } | null;
  cw_dogmas:  { number: number; text: string } | null;
};

const STATUS_ORDER = ["backlog","queued","scripted","shot","sequenced","testing","posted","iterating","vault","killed"];
const STATUS_COLORS: Record<string, string> = {
  backlog: "bg-zinc-700/40 text-zinc-300",
  queued: "bg-amber-500/20 text-amber-300 border-amber-500/40",
  scripted: "bg-blue-500/20 text-blue-300 border-blue-500/40",
  shot: "bg-cyan-500/20 text-cyan-300 border-cyan-500/40",
  sequenced: "bg-purple-500/20 text-purple-300 border-purple-500/40",
  testing: "bg-orange-500/20 text-orange-300 border-orange-500/40",
  posted: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
  iterating: "bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/40",
  vault: "bg-zinc-600/30 text-muted-foreground",
  killed: "bg-rose-700/20 text-rose-300 border-rose-700/40",
};

export function IdeationRolodexModule() {
  const qc = useQueryClient();
  const [audience, setAudience] = useState<"all" | "icp" | "nurture">("all");
  const [status, setStatus]     = useState<"all" | typeof STATUS_ORDER[number]>("all");
  const [search, setSearch]     = useState("");

  const { data: ideas, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["cw_ideas_rolodex"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("cw_ideas")
        .select("*, cw_pillars(code, name), cw_dogmas(number, text)")
        .order("score", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data as IdeaRow[];
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const filtered = useMemo(() => {
    return (ideas ?? []).filter((i) => {
      if (audience !== "all" && i.audience !== audience) return false;
      if (status !== "all" && i.status !== status) return false;
      if (search.trim() && !`${i.title} ${i.body ?? ""}`.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [ideas, audience, status, search]);

  const counts = useMemo(() => {
    const by: Record<string, number> = {};
    (ideas ?? []).forEach((i) => { by[i.status] = (by[i.status] ?? 0) + 1; });
    return by;
  }, [ideas]);

  const advance = async (idea: IdeaRow) => {
    const idx = STATUS_ORDER.indexOf(idea.status);
    const next = STATUS_ORDER[Math.min(idx + 1, STATUS_ORDER.length - 1)];
    const { error } = await (supabase as any).from("cw_ideas").update({ status: next }).eq("id", idea.id);
    if (error) { toast.error(error.message); return; }
    toast.success(`Advanced to ${next}`);
    qc.invalidateQueries({ queryKey: ["cw_ideas_rolodex"] });
  };
  const kill = async (idea: IdeaRow) => {
    const { error } = await (supabase as any).from("cw_ideas").update({ status: "killed" }).eq("id", idea.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Killed");
    qc.invalidateQueries({ queryKey: ["cw_ideas_rolodex"] });
  };
  const bump = async (idea: IdeaRow, delta: number) => {
    const newScore = (idea.score ?? 0) + delta;
    const { error } = await (supabase as any).from("cw_ideas").update({ score: newScore }).eq("id", idea.id);
    if (error) { toast.error(error.message); return; }
    qc.invalidateQueries({ queryKey: ["cw_ideas_rolodex"] });
  };

  if (isLoading) return <Skeleton className="h-96 w-full" />;

  return (
    <div className="space-y-4">
      <Card className="p-5 bg-white dark:bg-card border-amber-500/20">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-amber-400/80">Module 02 · the BRAIN ideating</p>
            <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Lightbulb className="h-6 w-6 text-amber-300" /> Ideation Rolodex
            </h2>
            <p className="text-sm text-muted-foreground mt-1 max-w-xl">
              5 demand sources → ranked backlog. Every idea = one pillar + one dogma + ICP/Nurture.
              Doctrine Law 01 enforced at DB layer.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isRefetching ? "animate-spin" : ""}`} /> Refresh
            </Button>
            <Badge variant="outline">{filtered.length} / {ideas?.length ?? 0}</Badge>
          </div>
        </div>

        {/* Filters */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-2 mt-4">
          <div className="md:col-span-5">
            <Input placeholder="Search title or body…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="md:col-span-3">
            <Select value={audience} onValueChange={(v) => setAudience(v as any)}>
              <SelectTrigger><SelectValue placeholder="Audience" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All audiences</SelectItem>
                <SelectItem value="icp">ICP (recruit-now)</SelectItem>
                <SelectItem value="nurture">Nurture (the 95%)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-4">
            <Select value={status} onValueChange={(v) => setStatus(v as any)}>
              <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All status ({ideas?.length ?? 0})</SelectItem>
                {STATUS_ORDER.map((s) => (
                  <SelectItem key={s} value={s}>{s} ({counts[s] ?? 0})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </Card>

      {filtered.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          No ideas match the filter. Drop a topic in the Sandcastles Lab to autogen more.
        </Card>
      ) : (
        <div className="grid gap-3">
          {filtered.map((idea) => (
            <Card key={idea.id} className="p-4 hover:border-amber-500/40 transition-colors">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] mb-2">
                    {idea.cw_pillars && <Badge variant="outline" className="text-amber-300 border-amber-500/40">{idea.cw_pillars.code} {idea.cw_pillars.name}</Badge>}
                    <Badge variant="outline" className={idea.audience === "icp" ? "border-emerald-500/40 text-emerald-300" : "border-zinc-600 text-muted-foreground"}>{idea.audience}</Badge>
                    <Badge className={STATUS_COLORS[idea.status] ?? "bg-zinc-700/40 text-zinc-300"}>{idea.status}</Badge>
                    {idea.cw_dogmas && <Badge variant="outline" className="text-rose-300/80 border-rose-500/30">D{String(idea.cw_dogmas.number).padStart(2, "0")}</Badge>}
                    <span className="text-muted-foreground">· {formatDistanceToNow(parseISO(idea.created_at), { addSuffix: true })}</span>
                  </div>
                  <div className="font-semibold leading-snug">{idea.title}</div>
                  {idea.body && <div className="text-sm text-muted-foreground mt-1 line-clamp-2">{idea.body}</div>}
                  {idea.demand_evidence && (
                    <div className="text-[11px] text-muted-foreground/70 italic mt-1.5">evidence: {idea.demand_evidence}</div>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1.5 shrink-0">
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="sm" onClick={() => bump(idea, -1)} className="h-7 w-7 p-0">−</Button>
                    <span className="font-mono text-sm w-6 text-center text-amber-300">{idea.score ?? 0}</span>
                    <Button variant="ghost" size="sm" onClick={() => bump(idea, 1)} className="h-7 w-7 p-0">+</Button>
                  </div>
                  <div className="flex gap-1">
                    {idea.status !== "killed" && idea.status !== "posted" && (
                      <Button size="sm" variant="outline" onClick={() => advance(idea)}>
                        <ArrowUpRight className="h-3 w-3 mr-1" /> Advance
                      </Button>
                    )}
                    {idea.status !== "killed" && (
                      <Button size="sm" variant="ghost" onClick={() => kill(idea)} className="text-rose-300">Kill</Button>
                    )}
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
