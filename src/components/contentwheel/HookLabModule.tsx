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
import { Hash, Trophy, Flame, RefreshCw, Plus, Check, X } from "lucide-react";
import { toast } from "sonner";

/**
 * ContentWheel Module 03 — Hook Lab
 * 3 C's gate (context / contrarian / open-loop). Minimum 2 hook variants per idea.
 */
type HookWithIdea = {
  id: string; idea_id: string; variant_label: string; text: string;
  keyword_a: string | null; keyword_b: string | null;
  is_agenda: boolean | null;
  context_ok: boolean | null; contrarian_ok: boolean | null; openloop_ok: boolean | null;
  cw_ideas: {
    title: string; audience: "icp" | "nurture"; status: string;
    cw_pillars: { code: string; name: string } | null;
  } | null;
};

export function HookLabModule() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<"all" | "agenda" | "complete-3c" | "incomplete-3c">("all");
  const [audience, setAudience] = useState<"all" | "icp" | "nurture">("all");
  const [search, setSearch] = useState("");
  const [newHook, setNewHook] = useState<{ ideaId: string; text: string } | null>(null);

  const { data: hooks, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["cw_hooks_lab"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("cw_hooks")
        .select("*, cw_ideas!inner(title, audience, status, cw_pillars(code, name))")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data as HookWithIdea[];
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const filtered = useMemo(() => {
    return (hooks ?? []).filter((h) => {
      const has3C = !!(h.context_ok && h.contrarian_ok && h.openloop_ok);
      if (filter === "agenda" && !h.is_agenda) return false;
      if (filter === "complete-3c" && !has3C) return false;
      if (filter === "incomplete-3c" && has3C) return false;
      if (audience !== "all" && h.cw_ideas?.audience !== audience) return false;
      if (search.trim() && !h.text.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [hooks, filter, audience, search]);

  // Group by idea to surface ideas with <2 hooks
  const byIdea = useMemo(() => {
    const map = new Map<string, HookWithIdea[]>();
    (hooks ?? []).forEach((h) => {
      if (!map.has(h.idea_id)) map.set(h.idea_id, []);
      map.get(h.idea_id)!.push(h);
    });
    return map;
  }, [hooks]);

  const ideasMissingVariants = useMemo(() => {
    const list: Array<{ ideaId: string; title: string; count: number }> = [];
    byIdea.forEach((hs, ideaId) => {
      if (hs.length < 2 && hs[0]?.cw_ideas) {
        list.push({ ideaId, title: hs[0].cw_ideas.title, count: hs.length });
      }
    });
    return list;
  }, [byIdea]);

  const toggle3C = async (h: HookWithIdea, field: "context_ok" | "contrarian_ok" | "openloop_ok" | "is_agenda") => {
    const newVal = !h[field];
    const { error } = await (supabase as any).from("cw_hooks").update({ [field]: newVal }).eq("id", h.id);
    if (error) { toast.error(error.message); return; }
    qc.invalidateQueries({ queryKey: ["cw_hooks_lab"] });
  };

  const addVariant = async (ideaId: string, text: string) => {
    if (!text.trim()) { toast.error("Hook text required"); return; }
    const existing = byIdea.get(ideaId) ?? [];
    const usedLabels = new Set(existing.map((h) => h.variant_label));
    const label = ["A","B","C","D","E"].find((l) => !usedLabels.has(l)) ?? `V${existing.length + 1}`;
    const { error } = await (supabase as any).from("cw_hooks").insert({
      idea_id: ideaId, variant_label: label, text: text.trim(),
      context_ok: false, contrarian_ok: false, openloop_ok: false, is_agenda: false,
    });
    if (error) { toast.error(error.message); return; }
    toast.success(`Variant ${label} added`);
    qc.invalidateQueries({ queryKey: ["cw_hooks_lab"] });
    setNewHook(null);
  };

  if (isLoading) return <Skeleton className="h-96 w-full" />;

  return (
    <div className="space-y-4">
      <Card className="p-5 bg-white dark:bg-slate-900 border-amber-500/20">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-amber-400/80">Module 03 · the 3 C's gate</p>
            <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Hash className="h-6 w-6 text-amber-300" /> Hook Lab
            </h2>
            <p className="text-sm text-muted-foreground mt-1 max-w-xl">
              Context · Contrarian · Open-loop. Minimum 2 hook variants per idea before it advances past scripted.
              Click ✓/✗ to score the 3 C's per variant. ★ = agenda hook (forces agree/disagree comments).
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isRefetching ? "animate-spin" : ""}`} /> Refresh
            </Button>
            <Badge variant="outline">{filtered.length} hooks</Badge>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-2 mt-4">
          <div className="md:col-span-5">
            <Input placeholder="Search hook text…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="md:col-span-3">
            <Select value={audience} onValueChange={(v) => setAudience(v as any)}>
              <SelectTrigger><SelectValue placeholder="Audience" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All audiences</SelectItem>
                <SelectItem value="icp">ICP only</SelectItem>
                <SelectItem value="nurture">Nurture only</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-4">
            <Select value={filter} onValueChange={(v) => setFilter(v as any)}>
              <SelectTrigger><SelectValue placeholder="3 C's filter" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All hooks</SelectItem>
                <SelectItem value="agenda">★ Agenda only</SelectItem>
                <SelectItem value="complete-3c">3 C's complete ✓</SelectItem>
                <SelectItem value="incomplete-3c">3 C's incomplete ✗</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </Card>

      {ideasMissingVariants.length > 0 && (
        <Card className="p-4 border-amber-500/40 bg-amber-500/5">
          <div className="flex items-start gap-2">
            <Flame className="h-4 w-4 text-amber-300 mt-0.5 shrink-0" />
            <div className="text-sm flex-1">
              <div className="font-semibold text-amber-200">{ideasMissingVariants.length} idea(s) under 2-variant minimum</div>
              <div className="text-xs text-muted-foreground mt-1 leading-relaxed">
                Doctrine: every idea needs ≥2 hook variants before it can advance past <code>scripted</code>.
                Add variants below or via Sandcastles re-runs.
              </div>
              <div className="mt-3 space-y-1.5">
                {ideasMissingVariants.slice(0, 5).map((m) => (
                  <div key={m.ideaId} className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate flex-1">{m.title} <span className="text-rose-300">({m.count}/2)</span></span>
                    <Button size="sm" variant="outline" onClick={() => setNewHook({ ideaId: m.ideaId, text: "" })}>
                      <Plus className="h-3 w-3 mr-1" /> Add variant
                    </Button>
                  </div>
                ))}
                {ideasMissingVariants.length > 5 && (
                  <div className="text-xs text-muted-foreground">+{ideasMissingVariants.length - 5} more</div>
                )}
              </div>
              {newHook && (
                <div className="mt-3 flex gap-2">
                  <Input
                    placeholder="New hook text (≤80 chars, 7th-grade English)"
                    value={newHook.text}
                    onChange={(e) => setNewHook({ ...newHook, text: e.target.value })}
                    className="text-sm"
                  />
                  <Button size="sm" onClick={() => addVariant(newHook.ideaId, newHook.text)}>Add</Button>
                  <Button size="sm" variant="ghost" onClick={() => setNewHook(null)}>Cancel</Button>
                </div>
              )}
            </div>
          </div>
        </Card>
      )}

      <div className="space-y-2">
        {filtered.map((h) => (
          <Card key={h.id} className="p-3 hover:border-amber-500/40 transition-colors">
            <div className="flex items-start gap-3">
              <div className="font-mono text-xs text-amber-300 mt-0.5 shrink-0">{h.variant_label}</div>
              <div className="flex-1 min-w-0">
                <div className="text-sm leading-snug">{h.text}</div>
                <div className="flex flex-wrap items-center gap-1.5 mt-2 text-[10px] uppercase tracking-[0.1em]">
                  {h.cw_ideas?.cw_pillars && (
                    <Badge variant="outline" className="border-amber-500/30 text-amber-300/90">
                      {h.cw_ideas.cw_pillars.code}
                    </Badge>
                  )}
                  <Badge variant="outline" className={h.cw_ideas?.audience === "icp" ? "border-emerald-500/40 text-emerald-300" : "border-zinc-600 text-zinc-400"}>
                    {h.cw_ideas?.audience}
                  </Badge>
                  <span className="text-muted-foreground truncate max-w-md" title={h.cw_ideas?.title ?? ""}>
                    → {h.cw_ideas?.title}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {[
                  { key: "context_ok",    label: "C", title: "Context — plain-English keyword in first words" },
                  { key: "contrarian_ok", label: "C", title: "Contrarian — cuts against niche common-knowledge" },
                  { key: "openloop_ok",   label: "O", title: "Open-loop — promise that can't close inside the hook" },
                  { key: "is_agenda",     label: "★", title: "Agenda — hill-to-die-on, forces agree/disagree" },
                ].map((cfg) => {
                  const on = !!h[cfg.key as keyof HookWithIdea];
                  return (
                    <button
                      key={cfg.key}
                      onClick={() => toggle3C(h, cfg.key as any)}
                      title={cfg.title}
                      className={`h-7 w-7 rounded text-xs font-mono font-semibold transition-colors border ${on ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/50" : "bg-slate-50 dark:bg-zinc-800 text-zinc-500 border-zinc-700 hover:border-zinc-500"}`}
                    >
                      {on ? <Check className="h-3.5 w-3.5 mx-auto" /> : cfg.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </Card>
        ))}
        {filtered.length === 0 && (
          <Card className="p-8 text-center text-sm text-muted-foreground">No hooks match the filter.</Card>
        )}
      </div>
    </div>
  );
}
