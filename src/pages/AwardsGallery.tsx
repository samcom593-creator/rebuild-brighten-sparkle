import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { Trophy, Search, Filter, Mail, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { GlassCard } from "@/components/ui/glass-card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface PlaqueRow {
  id: string;
  agent_id: string;
  milestone_type: string;
  milestone_date: string;
  amount: number | null;
  badge_label: string | null;
  color_hex: string | null;
  image_svg_url: string | null;
  image_png_url: string | null;
  email_sent_at: string | null;
  email_delivery_status: string | null;
  awarded_at: string | null;
  agent_name?: string;
}

const TIER_META: Record<string, { label: string; accent: string; emoji: string }> = {
  single_day_platinum: { label: "Platinum",    accent: "border-purple-400/50 bg-purple-500/10 text-purple-300",  emoji: "💎" },
  single_day:          { label: "Gold",        accent: "border-amber-400/50 bg-amber-500/10 text-amber-300",      emoji: "🥇" },
  single_day_bronze:   { label: "Bronze",      accent: "border-orange-600/50 bg-orange-700/10 text-orange-300",   emoji: "🥉" },
  weekly:              { label: "Weekly",      accent: "border-sky-400/50 bg-sky-500/10 text-sky-300",            emoji: "💠" },
  monthly:             { label: "Monthly",     accent: "border-violet-400/50 bg-violet-500/10 text-violet-300",   emoji: "👑" },
  hot_streak:          { label: "Streak",      accent: "border-rose-400/50 bg-rose-500/10 text-rose-300",         emoji: "🔥" },
  team_week_50k:       { label: "Team Week",   accent: "border-emerald-400/50 bg-emerald-500/10 text-emerald-300",emoji: "🏆" },
  team_two_day_20k:    { label: "Team 2-Day",  accent: "border-emerald-400/50 bg-emerald-500/10 text-emerald-300",emoji: "⚡" },
  team_single_day_10k: { label: "Team Day",    accent: "border-emerald-400/50 bg-emerald-500/10 text-emerald-300",emoji: "⭐" },
  streak_5:            { label: "5-Streak",    accent: "border-rose-400/50 bg-rose-500/10 text-rose-300",         emoji: "🔥" },
  first_deal_of_day:   { label: "First Deal",  accent: "border-primary/50 bg-primary/10 text-primary",            emoji: "🌅" },
  diamond_week:        { label: "Diamond",     accent: "border-cyan-400/50 bg-cyan-500/10 text-cyan-300",         emoji: "💎" },
};

function fmt$(n: number | null): string {
  if (!n) return "—";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${Math.round(n).toLocaleString()}`;
}

export default function AwardsGallery() {
  const { isAdmin } = useAuth();
  const [rows, setRows] = useState<PlaqueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [tierFilter, setTier] = useState<string>("all");
  const [emailing, setEmailing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data: pl } = await supabase
          .from("plaque_awards")
          .select("id, agent_id, milestone_type, milestone_date, amount, badge_label, color_hex, image_svg_url, image_png_url, email_sent_at, email_delivery_status, awarded_at")
          .order("milestone_date", { ascending: false })
          .limit(500);
        const list = (pl ?? []) as PlaqueRow[];
        const agentIds = [...new Set(list.map(p => p.agent_id).filter(Boolean))];
        const { data: agents } = agentIds.length
          ? await supabase.from("agents").select("id, profile:profiles(full_name)").in("id", agentIds)
          : { data: [] } as any;
        const nameMap: Record<string, string> = {};
        for (const a of (agents ?? []) as any[]) nameMap[a.id] = a.profile?.full_name ?? "Agent";
        if (!cancelled) setRows(list.map(r => ({ ...r, agent_name: nameMap[r.agent_id] ?? "Agent" })));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter(r => tierFilter === "all" || r.milestone_type === tierFilter)
      .filter(r => !q || (r.agent_name ?? "").toLowerCase().includes(q) || r.milestone_type.toLowerCase().includes(q));
  }, [rows, search, tierFilter]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of rows) c[r.milestone_type] = (c[r.milestone_type] ?? 0) + 1;
    return c;
  }, [rows]);

  const totalValue = useMemo(
    () => filtered.reduce((s, r) => s + Number(r.amount ?? 0), 0),
    [filtered],
  );

  const emailAllToMe = async () => {
    setEmailing(true);
    try {
      const { data, error } = await supabase.functions.invoke("send-plaque-batch", {
        body: { limit: 100, target_admin_email: true },
      });
      if (error) throw error;
      toast.success(`Sent ${(data as any)?.sent ?? 0} plaques`);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed — send-plaque-batch may not be deployed yet");
    } finally {
      setEmailing(false);
    }
  };

  return (
    <div className="space-y-4 p-4 md:p-6 max-w-[1400px] mx-auto">
      <div className="flex flex-wrap items-center gap-3">
        <Trophy className="h-6 w-6 text-amber-400" />
        <h1 className="text-2xl md:text-3xl font-bold">Awards Gallery</h1>
        {isAdmin && (
          <Button
            size="sm"
            variant="outline"
            className="ml-auto gap-1.5"
            onClick={emailAllToMe}
            disabled={emailing}
          >
            {emailing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}
            Email First 100 to Me
          </Button>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <GlassCard className="p-3">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Total Plaques</div>
          <div className="text-2xl font-bold tabular-nums">{filtered.length}</div>
        </GlassCard>
        <GlassCard className="p-3">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Total Value</div>
          <div className="text-2xl font-bold tabular-nums text-emerald-400">{fmt$(totalValue)}</div>
        </GlassCard>
        <GlassCard className="p-3">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">💎 Platinum</div>
          <div className="text-2xl font-bold tabular-nums text-purple-300">{counts.single_day_platinum ?? 0}</div>
        </GlassCard>
        <GlassCard className="p-3">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">🥇 Gold</div>
          <div className="text-2xl font-bold tabular-nums text-amber-300">{counts.single_day ?? 0}</div>
        </GlassCard>
        <GlassCard className="p-3">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">🥉 Bronze</div>
          <div className="text-2xl font-bold tabular-nums text-orange-300">{counts.single_day_bronze ?? 0}</div>
        </GlassCard>
      </div>

      <GlassCard className="p-3 flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search agent or tier…"
            className="pl-9 h-9"
          />
        </div>
        <Select value={tierFilter} onValueChange={setTier}>
          <SelectTrigger className="w-[170px] h-9"><Filter className="h-3.5 w-3.5 mr-1.5" /><SelectValue placeholder="All tiers" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All tiers</SelectItem>
            {Object.entries(TIER_META).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v.emoji} {v.label} ({counts[k] ?? 0})</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </GlassCard>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <GlassCard key={i} className="p-4 animate-pulse h-48" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <GlassCard className="p-12 text-center text-muted-foreground">
          No plaques match these filters yet.
        </GlassCard>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map(p => {
            const meta = TIER_META[p.milestone_type] ?? { label: p.milestone_type, accent: "border-border bg-muted/30 text-foreground", emoji: "🏅" };
            return (
              <GlassCard key={p.id} className={cn("p-4 transition-transform hover:scale-[1.02]", meta.accent.split(" ")[0])}>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">{meta.emoji}</span>
                    <Badge className={cn("text-[10px] border", meta.accent)}>{meta.label}</Badge>
                  </div>
                  {p.email_sent_at ? (
                    <Badge variant="outline" className="text-[9px] border-emerald-500/30 text-emerald-300">emailed</Badge>
                  ) : null}
                </div>
                {p.image_svg_url ? (
                  <div className="mb-3 rounded-md overflow-hidden bg-background/40" style={{ aspectRatio: "9 / 16", maxHeight: 220 }}>
                    <img src={p.image_svg_url} alt="" className="w-full h-full object-contain" />
                  </div>
                ) : (
                  <div className="mb-3 h-32 rounded-md bg-muted/20 flex items-center justify-center text-xs text-muted-foreground">
                    Image pending
                  </div>
                )}
                <div className="text-sm font-semibold truncate">{p.agent_name}</div>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-xs text-muted-foreground">
                    {p.milestone_date ? format(new Date(p.milestone_date), "MMM d, yyyy") : "—"}
                  </span>
                  <span className="text-sm font-bold tabular-nums text-emerald-400">{fmt$(p.amount)}</span>
                </div>
              </GlassCard>
            );
          })}
        </div>
      )}
    </div>
  );
}
