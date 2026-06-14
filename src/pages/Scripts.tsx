// Scripts library · mirrors AgentLink's "Scripts" sidebar item
//
// Central library of every APEX sales script · grouped by category:
//   - inbound     (Switch Center scripts — open, fact-find, close)
//   - objections  (rebuttals — spouse, price, stall, etc.)
//   - recruiting  (DMs, interview frame, close)
//   - brand       (the Apex Standard voice)
//
// Reads from sales_scripts table (shipped 2026-06-13 with 10 starter rows).
// Click-to-copy each script body. Token interpolation {first_name},
// {agent_name}, etc. left as-is — agent fills in live.

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ScrollText, Copy, Check, RefreshCw, Filter, Tag, Phone, Shield, Users, Crown, Search,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { usePageTitle } from "@/hooks/usePageTitle";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

interface ScriptRow {
  id: string;
  title: string;
  category: string;
  body: string;
  tags: string[] | null;
  author_name: string | null;
  sort_order: number | null;
}

const CATEGORIES = [
  { key: "all",        label: "All",        icon: ScrollText },
  { key: "inbound",    label: "Inbound",    icon: Phone },
  { key: "objections", label: "Objections", icon: Shield },
  { key: "recruiting", label: "Recruiting", icon: Users },
  { key: "brand",      label: "Brand",      icon: Crown },
] as const;

export default function Scripts() {
  usePageTitle("Scripts · APEX");
  const [activeCat, setActiveCat] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const scripts = useQuery({
    queryKey: ["sales-scripts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales_scripts" as any)
        .select("id, title, category, body, tags, author_name, sort_order")
        .eq("is_active", true)
        .order("sort_order", { ascending: true })
        .order("title");
      if (error) throw error;
      return (data ?? []) as unknown as ScriptRow[];
    },
    staleTime: 5 * 60_000,
  });

  const filtered = useMemo(() => {
    const all = scripts.data ?? [];
    const lowered = search.trim().toLowerCase();
    return all.filter((s) => {
      if (activeCat !== "all" && s.category !== activeCat) return false;
      if (!lowered) return true;
      return (
        s.title.toLowerCase().includes(lowered) ||
        s.body.toLowerCase().includes(lowered) ||
        (s.tags ?? []).some((t) => t.toLowerCase().includes(lowered))
      );
    });
  }, [scripts.data, activeCat, search]);

  const copy = async (s: ScriptRow) => {
    try {
      await navigator.clipboard.writeText(s.body);
      setCopiedId(s.id);
      toast.success("Script copied to clipboard");
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      toast.error("Could not copy — clipboard blocked");
    }
  };

  const countByCat = (k: string) => {
    if (k === "all") return scripts.data?.length ?? 0;
    return (scripts.data ?? []).filter((s) => s.category === k).length;
  };

  return (
    <div className="page-enter px-4 sm:px-6 pb-24 space-y-5">
      <PageHeader
        eyebrow="Library"
        eyebrowIcon={<ScrollText className="h-3 w-3" />}
        title="Scripts"
        subtitle="Every APEX sales script — inbound, objections, recruiting, brand voice. Click to copy."
        actions={
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-11">{scripts.data?.length ?? 0} scripts</Badge>
            <Button variant="outline" size="sm" onClick={() => scripts.refetch()}>
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${scripts.isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        }
      />

      {/* Premium gradient hero (v6 §31 — amber) */}
      <div className="relative overflow-hidden rounded-3xl border border-amber-500/25 bg-gradient-to-br from-slate-950 via-slate-900 to-amber-950 text-white shadow-[0_0_48px_-12px_hsl(168_70%_45%/0.25)]">
        <div className="absolute -top-24 -right-24 h-72 w-72 rounded-full bg-amber-500/15 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-32 -left-24 h-80 w-80 rounded-full bg-emerald-500/10 blur-3xl pointer-events-none" />
        <div className="relative p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75 animate-ping" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-500" />
              </span>
              <p className="text-[11px] uppercase tracking-[0.32em] font-bold text-amber-300">SCRIPTS LIBRARY · LIVE</p>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">TOTAL SCRIPTS</p>
              <p className="text-[28px] leading-none font-black tabular-nums text-white">{scripts.data?.length ?? 0}</p>
              <p className="text-[10px] text-white/40 tabular-nums">active in library</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">CATEGORIES</p>
              <p className="text-[28px] leading-none font-black tabular-nums text-white">{CATEGORIES.length - 1}</p>
              <p className="text-[10px] text-white/40 tabular-nums">inbound · objections · recruiting · brand</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">INBOUND</p>
              <p className="text-[28px] leading-none font-black tabular-nums text-white">{countByCat("inbound")}</p>
              <p className="text-[10px] text-white/40 tabular-nums">switch center opens</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">OBJECTIONS</p>
              <p className="text-[28px] leading-none font-black tabular-nums text-white">{countByCat("objections")}</p>
              <p className="text-[10px] text-white/40 tabular-nums">rebuttals ready</p>
            </div>
          </div>
        </div>
      </div>

      {/* Search + category bar */}
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search scripts, tags, body…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex gap-1 overflow-x-auto">
          {CATEGORIES.map((c) => (
            <button
              key={c.key}
              onClick={() => setActiveCat(c.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-12 font-medium whitespace-nowrap transition-base ${
                activeCat === c.key
                  ? "bg-amber-500 text-white"
                  : "bg-muted text-foreground hover:bg-muted/80"
              }`}
            >
              <c.icon className="h-3 w-3" />
              {c.label}
              <span className="text-11 opacity-70">({countByCat(c.key)})</span>
            </button>
          ))}
        </div>
      </div>

      {/* Cards */}
      {scripts.isLoading ? (
        <div className="grid gap-3 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-40" />)}
        </div>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="p-8 text-center text-13 text-muted-foreground">
          <Filter className="h-6 w-6 mx-auto mb-2 opacity-50" />
          Nothing matches that filter yet. Clear the search or switch categories — every closer keeps a script within reach.
        </CardContent></Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {filtered.map((s) => {
            const isCopied = copiedId === s.id;
            return (
              <Card key={s.id} className="hover:bg-muted/20 transition-base group">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-14 font-bold leading-tight">{s.title}</p>
                      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                        <Badge variant="outline" className="text-11 capitalize">{s.category}</Badge>
                        {(s.tags ?? []).slice(0, 3).map((t) => (
                          <Badge key={t} variant="outline" className="text-11 bg-slate-500/10 border-slate-500/30">
                            <Tag className="h-2.5 w-2.5 mr-1" /> {t}
                          </Badge>
                        ))}
                      </div>
                    </div>
                    <Button
                      variant={isCopied ? "default" : "outline"}
                      size="sm"
                      className={isCopied ? "bg-emerald-600 hover:bg-emerald-700" : ""}
                      onClick={() => copy(s)}
                    >
                      {isCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                  <pre className="text-12 text-foreground/85 whitespace-pre-wrap font-sans leading-relaxed bg-muted/30 rounded-md p-3 max-h-48 overflow-auto">
                    {s.body}
                  </pre>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
