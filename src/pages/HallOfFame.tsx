// HallOfFame v4 — cinematic trophy wall for Apex production milestones.
//
// Data: plaque_awards. Standings use the complete verified history,
// independently of the 240-row wall window. Amount units vary by milestone.
//
// Layout:
//   1. Stats strip — total plaques, distinct milestones and honorees
//   2. Podium — top 3 by plaque count (1st elevated, gold halo)
//   3. Honorable mentions — ranks 4-10
//   4. Filter strip — category + period + agent search
//   5. Plaque wall — grid with click-to-detail dialog
//   6. Plaque detail dialog — full-size, share, story

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  Crown, Trophy, Users, Target, Sparkles, Search, Share2, Calendar,
  Award, X, Copy, Medal, AlertTriangle,
} from "lucide-react";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useBusinessToday } from "@/hooks/useBusinessToday";
import { loadPlaqueFacts, rankPlaqueHonorees, summarizePlaques } from "@/lib/dashboardRecords";
import { presentPlaqueDate, presentPlaqueMetric } from "@/components/awards/plaqueAwardPresentation";
import {
  resolveAgentNames,
  AGENT_NAME_FALLBACK,
} from "@/shared/api/agentDisplayNames";
import { PageHeader } from "@/components/ui/page-header";
import { GlassCard } from "@/components/ui/glass-card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// ─── Types ──────────────────────────────────────────────────────────────────
interface Plaque {
  id: string;
  agent_id: string;
  milestone_type: string;
  milestone_date: string | null;
  amount: number | null;
  badge_label: string | null;
  color_hex: string | null;
  image_svg_url: string | null;
  image_png_url: string | null;
  custom_photo_url: string | null;
  awarded_at: string | null;
  // /plaque/:slug (PlaqueShare.tsx) resolves the public page by share_slug,
  // NOT plaque.id — copying plaque.id to the clipboard rendered a broken link.
  share_slug: string | null;
  agent_name: string;
  agent_photo: string | null;
}

type Category = "all" | "personal" | "business" | "referral";
type Period = "all" | "month" | "quarter" | "year";

// ─── Milestone → category map (intentionally explicit, easy to extend) ──────
const CATEGORY_MAP: Record<string, Exclude<Category, "all">> = {
  // personal
  single_day_platinum: "personal",
  single_day: "personal",
  single_day_bronze: "personal",
  diamond_week: "personal",
  monthly_top6: "personal",
  monthly_20k: "personal",
  hot_streak: "personal",
  first_deal_of_day: "personal",
  first_deal_ever: "personal",
  comeback_champion: "personal",
  "FIRST DEAL": "personal",
  "10K CLUB": "personal",
  "25K CRUSHER": "personal",
  "40K ELITE": "personal",
  "75K Galaxy": "personal",
  "7-DAY STREAK": "personal",
  lifetime_100k: "personal",
  march_2026_top6: "personal",
  // business / team
  team_week_50k: "business",
  team_two_day_20k: "business",
  team_single_day_10k: "business",
  team_weekly: "business",
  team_monthly: "business",
  manager_quarterly: "business",
  agency_milestone: "business",
  // referral / recruiter
  recruiter_first_producer: "referral",
  recruiter_team_milestone: "referral",
  referral_chain: "referral",
};

const CATEGORY_META: Record<Exclude<Category, "all">, { label: string; icon: typeof Crown; chipClass: string }> = {
  personal: { label: "Personal",  icon: Trophy, chipClass: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/40" },
  business: { label: "Business",  icon: Users,  chipClass: "bg-info/15 text-info dark:text-info border-info/30" },
  referral: { label: "Referral",  icon: Target, chipClass: "bg-violet-500/15 text-violet-600 dark:text-violet-400 border-violet-500/40" },
};

function prettyMilestone(s: string): string {
  // Already pretty (uppercase + spaces)?
  if (/[A-Z]/.test(s) && /\s/.test(s)) return s;
  // snake_case → Title Case
  return s.split("_").map((w) => w[0]?.toUpperCase() + w.slice(1)).join(" ");
}

// ─── Main ───────────────────────────────────────────────────────────────────
export default function HallOfFame() {
  const { user } = useAuth();
  const today = useBusinessToday();
  const [activeCategory, setActiveCategory] = useState<Category>("all");
  const [period, setPeriod] = useState<Period>("all");
  const [search, setSearch] = useState("");
  const [openPlaque, setOpenPlaque] = useState<Plaque | null>(null);

  // ── Plaques (last 240 awarded, filtered client-side) ────────────────────
  const { data: plaques = [], isLoading: loadingPlaques, isError: plaquesError } = useQuery({
    queryKey: ["hof-plaques", user?.id],
    enabled: Boolean(user?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("plaque_awards")
        .select(`
          id, agent_id, milestone_type, milestone_date, amount,
          badge_label, color_hex, image_svg_url, image_png_url,
          custom_photo_url, awarded_at, share_slug,
          agent:agents!plaque_awards_agent_id_fkey(id, user_id, display_name)
        `)
        .order("awarded_at", { ascending: false })
        .limit(240);
      if (error) throw error;
      const resolved = await resolveAgentNames(
        (data ?? []).flatMap(row => row.agent ? [row.agent] : []),
      );
      return (data ?? []).map(row => ({
        ...row,
        agent_name: resolved.get(row.agent?.id)?.name ?? AGENT_NAME_FALLBACK,
        agent_photo: resolved.get(row.agent?.id)?.avatarUrl ?? null,
      }));
    },
  });

  // Totals and standings share the same complete award history, not the grid window.
  const awardFacts = useQuery({
    queryKey: ["hof-award-facts", user?.id, today],
    enabled: Boolean(user?.id),
    queryFn: ({ signal }) => loadPlaqueFacts(signal),
    staleTime: 60_000,
  });
  const stats = useMemo(() => awardFacts.data ? summarizePlaques(awardFacts.data, today) : null, [awardFacts.data, today]);

  // ── Top ten by plaque count, across the complete verified history ───────
  const { data: topEarners = [], isLoading: loadingTop, isError: topError } = useQuery({
    queryKey: ["hof-top-earners", user?.id, awardFacts.dataUpdatedAt],
    enabled: Boolean(user?.id && awardFacts.data) && !awardFacts.isError,
    queryFn: async () => {
      const leaders = rankPlaqueHonorees(awardFacts.data ?? []).slice(0, 10)
        .map(row => ({ ...row, agent_name: AGENT_NAME_FALLBACK, avatar_url: null as string | null }));
      if (!leaders.length) return leaders;
      const { data: identities, error } = await supabase.from("agents").select("id,user_id,display_name").in("id", leaders.map(row => row.agent_id));
      if (error) throw error;
      const resolved = await resolveAgentNames(identities ?? []);
      return leaders.map(row => ({ ...row, agent_name: resolved.get(row.agent_id)?.name ?? AGENT_NAME_FALLBACK, avatar_url: resolved.get(row.agent_id)?.avatarUrl ?? null }));
    },
  });

  // ── Filtered plaque grid ───────────────────────────────────────────────
  const filteredPlaques = useMemo(() => {
    const now = Date.now();
    const cutoff =
      period === "month" ? now - 30 * 86_400_000 :
      period === "quarter" ? now - 90 * 86_400_000 :
      period === "year" ? now - 365 * 86_400_000 : 0;
    return plaques.filter((p) => {
      if (activeCategory !== "all") {
        const cat = CATEGORY_MAP[p.milestone_type];
        if (cat !== activeCategory) return false;
      }
      if (cutoff && (!p.awarded_at || new Date(p.awarded_at).getTime() < cutoff)) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        if (!p.agent_name.toLowerCase().includes(q) &&
            !p.milestone_type.toLowerCase().includes(q) &&
            !(p.badge_label ?? "").toLowerCase().includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [plaques, activeCategory, period, search]);

  const podium = topEarners.slice(0, 3);
  const honorableMentions = topEarners.slice(3);

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="page-enter px-4 sm:px-6 pb-24 space-y-6">
      <PageHeader
        accent="amber"
        eyebrow="Production · Hall of Fame"
        eyebrowIcon={<Crown className="h-3 w-3" />}
        title="Hall of Fame"
        subtitle="Every plaque earned at Galaxy. Personal closers, team builders, and the recruiters who built producing teams — all part of the empire."
      />

      {/* ── Stats strip ───────────────────────────────────────────── */}
      {awardFacts.isError ? <div role="alert" className="rounded-md border border-border p-4"><p>Award totals could not be verified.</p><Button variant="outline" className="mt-2" onClick={()=>void awardFacts.refetch()}>Retry award totals</Button></div> : <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile icon={Trophy} label="Total plaques" value={stats?.total ?? 0} loading={!stats} color="text-amber-500 dark:text-amber-400" />
        <StatTile icon={Award} label="Milestone types" value={stats?.milestoneTypes ?? 0} loading={!stats} color="text-emerald-500 dark:text-emerald-400" />
        <StatTile icon={Users} label="Honorees" value={stats?.honorees ?? 0} loading={!stats} color="text-violet-500 dark:text-violet-400" />
        <StatTile icon={Calendar} label="This month" value={stats?.thisMonth ?? 0} loading={!stats} color="text-primary" />
      </div>}
      <p className="text-sm text-muted-foreground">Each award shows its recorded unit. Recognition can overlap; amounts are not added into production or commission. The wall shows the latest 240 plaques; counts and standings use the full history.</p>

      {/* ── Podium ────────────────────────────────────────────────── */}
      <GlassCard className="p-5 sm:p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-[12px] uppercase tracking-widest text-muted-foreground font-semibold">All-time leaders</p>
            <h2 className="text-2xl font-bold flex items-center gap-2">
              <Crown className="h-6 w-6 text-amber-500" /> The Top 3
            </h2>
          </div>
          <Badge variant="outline" className="text-xs">by plaque count</Badge>
        </div>
        {awardFacts.isLoading || loadingTop ? (
          <div className="grid sm:grid-cols-3 gap-4">
            {/* stable-key-allow:skeleton-static-array */}
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-44 w-full" />)}
          </div>
        ) : awardFacts.isError || topError ? (
          <EmptyState
            variant="warning"
            icon={<AlertTriangle className="h-7 w-7" />}
            title="The leaderboard didn't load"
            description="This is a load error, not an empty board — the standings couldn't be read. Refresh in a moment."
          />
        ) : podium.length === 0 ? (
          <EmptyState icon={<Trophy className="h-7 w-7" />} title="No plaques awarded yet" />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
            {/* Re-order for visual podium: 2nd left, 1st center elevated, 3rd right */}
            {/* stable-key-allow:positional-podium-tuple */}
            {[1, 0, 2].map((idx) => {
              const e = podium[idx];
              if (!e) return <div key={idx} />;
              const place = idx + 1;
              const isFirst = place === 1;
              const medal = place === 1
                ? { label: "1st", icon: Crown, color: "text-amber-500 dark:text-amber-400", ring: "ring-amber-500/60", bg: "from-amber-500/15", badge: "bg-amber-500" }
                : place === 2
                ? { label: "2nd", icon: Medal, color: "text-muted-foreground dark:text-slate-300", ring: "ring-slate-400/60", bg: "from-slate-400/15", badge: "bg-slate-400" }
                : { label: "3rd", icon: Medal, color: "text-orange-500 dark:text-orange-400", ring: "ring-orange-500/60", bg: "from-orange-500/15", badge: "bg-orange-500" };
              const Medallion = medal.icon;
              return (
                <motion.div
                  key={e.agent_id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.05 * idx, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                  className={cn(
                    "relative rounded-md border border-border/60 p-5 text-center overflow-hidden",
                    medal.bg,
                    isFirst && "sm:scale-[1.04] shadow-[0_8px_40px_hsl(45_95%_55%/0.25)] border-amber-500/50",
                  )}
                >
                  {/* Rank badge */}
                  <span className={cn(
                    "absolute -top-3 left-1/2 -translate-x-1/2 text-foreground text-[12px] font-bold px-3 py-1 rounded-full shadow-lg",
                    medal.badge,
                  )}>
                    {medal.label}
                  </span>
                  <div className="flex flex-col items-center gap-3 pt-3">
                    <div className={cn("relative h-20 w-20 rounded-full overflow-hidden ring-4", medal.ring)}>
                      {e.avatar_url ? (
                        <img src={e.avatar_url} alt={e.agent_name} className="h-full w-full object-cover" />
                      ) : (
                        <div className="h-full w-full bg-muted flex items-center justify-center text-2xl font-bold">
                          {e.agent_name.split(" ").map((s) => s[0]).slice(0, 2).join("")}
                        </div>
                      )}
                      <Medallion className={cn("absolute -bottom-1 -right-1 h-7 w-7 drop-shadow-lg", medal.color)} />
                    </div>
                    <div>
                      <p className="font-bold text-lg leading-tight">{e.agent_name}</p>
                      <p className={cn("text-xs uppercase tracking-wider mt-0.5", medal.color)}>
                        {place === 1 ? "Champion" : place === 2 ? "Runner-up" : "Third"}
                      </p>
                    </div>
                    <div className="flex items-center justify-center gap-4 pt-2 border-t border-border/40 w-full">
                      <div>
                        <p className="text-2xl font-bold tabular-nums">{e.plaque_count}</p>
                        <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Plaques</p>
                      </div>
                      <span className="h-8 w-px bg-border" />
                      <div>
                        <p className="text-2xl font-bold tabular-nums text-emerald-500 dark:text-emerald-400">
                          {e.milestone_types}
                        </p>
                        <p className="text-xs uppercase tracking-wider text-muted-foreground">Milestone types</p>
                      </div>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}

        {/* Honorable mentions */}
        {honorableMentions.length > 0 && (
          <div className="mt-5 pt-4 border-t border-border/40">
            <p className="text-[12px] uppercase tracking-widest text-muted-foreground font-semibold mb-3">
              Honorable mentions
            </p>
            <div className="flex gap-2 overflow-x-auto scrollbar-custom pb-2">
              {honorableMentions.map((e, i) => (
                <div
                  key={e.agent_id}
                  className="flex items-center gap-2 rounded-full border border-border/50 bg-card/60 px-2.5 py-1.5 shrink-0 hover:border-primary/40 transition-colors"
                >
                  <span className="text-[11px] font-bold text-muted-foreground w-5 text-right">#{i + 4}</span>
                  {e.avatar_url ? (
                    <img src={e.avatar_url} alt="" className="h-6 w-6 rounded-full object-cover" />
                  ) : (
                    <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center text-[11px] font-bold">
                      {e.agent_name.split(" ").map((s) => s[0]).slice(0, 2).join("")}
                    </div>
                  )}
                  <span className="text-sm font-medium">{e.agent_name}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">· {e.plaque_count}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </GlassCard>

      {/* ── Filter strip ─────────────────────────────────────────── */}
      <GlassCard className="p-3">
        <Tabs value={activeCategory} onValueChange={(v) => setActiveCategory(v as Category)}>
          <div className="flex flex-col gap-2 md:flex-row md:items-center">
            <TabsList className="grid grid-cols-4 sm:w-auto sm:flex">
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="personal" className="gap-1.5"><Trophy className="h-3 w-3" />Personal</TabsTrigger>
              <TabsTrigger value="business" className="gap-1.5"><Users className="h-3 w-3" />Business</TabsTrigger>
              <TabsTrigger value="referral" className="gap-1.5"><Target className="h-3 w-3" />Referral</TabsTrigger>
            </TabsList>
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search agent or milestone"
                className="pl-9"
              />
            </div>
            <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
              <SelectTrigger aria-label="Recognition period" className="md:w-[150px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All time</SelectItem>
                <SelectItem value="month">Last 30 days</SelectItem>
                <SelectItem value="quarter">Last 90 days</SelectItem>
                <SelectItem value="year">Last 365 days</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </Tabs>
      </GlassCard>

      {/* ── Plaque wall ──────────────────────────────────────────── */}
      {loadingPlaques ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {/* stable-key-allow:skeleton-static-array */}
          {Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="aspect-[3/4] w-full" />)}
        </div>
      ) : plaquesError ? (
        <EmptyState
          variant="warning"
          icon={<AlertTriangle className="h-7 w-7" />}
          title="The plaque wall didn't load"
          description="This is a load error, not an empty wall — the awards couldn't be read. Refresh in a moment."
        />
      ) : filteredPlaques.length === 0 ? (
        <EmptyState
          icon={<Trophy className="h-7 w-7" />}
          title="No plaques match these filters"
          description="Widen the period or clear the search. New plaques drop as agents close milestones."
          actions={
            <Button size="sm" variant="ghost" onClick={() => { setSearch(""); setActiveCategory("all"); setPeriod("all"); }}>
              Clear filters
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {filteredPlaques.map((p, i) => (
            <PlaqueCard key={p.id} plaque={p} onClick={() => setOpenPlaque(p)} delay={i * 0.01} />
          ))}
        </div>
      )}

      {/* ── Detail dialog ────────────────────────────────────────── */}
      <Dialog open={!!openPlaque} onOpenChange={(o) => !o && setOpenPlaque(null)}>
        <DialogContent className="sm:max-w-lg p-0 overflow-hidden">
          <DialogTitle className="sr-only">{openPlaque?.badge_label ?? "Plaque detail"}</DialogTitle>
          {openPlaque && <PlaqueDetail plaque={openPlaque} onClose={() => setOpenPlaque(null)} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

interface StatTileProps {
  icon: React.ElementType;
  label: string;
  value: number;
  loading: boolean;
  color: string;
  formatter?: (n: number) => string;
}
function StatTile({ icon: Icon, label, value, loading, color, formatter }: StatTileProps) {
  return (
    <GlassCard className="p-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[12px] uppercase tracking-widest text-muted-foreground font-semibold">{label}</p>
          {loading ? (
            <Skeleton className="h-9 w-24 mt-1" />
          ) : (
            <p className={cn("text-3xl font-bold tabular-nums mt-1", color)}>
              {formatter ? formatter(value) : value.toLocaleString()}
            </p>
          )}
        </div>
        <Icon className={cn("h-7 w-7 opacity-70", color)} />
      </div>
    </GlassCard>
  );
}

interface PlaqueCardProps { plaque: Plaque; onClick: () => void; delay: number; }
function PlaqueCard({ plaque, onClick, delay }: PlaqueCardProps) {
  const img = plaque.image_png_url || plaque.image_svg_url || plaque.custom_photo_url;
  const metric = presentPlaqueMetric(plaque);
  const milestoneDate = presentPlaqueDate({ ...plaque, milestone_date: plaque.milestone_date ?? "" });
  const cat = CATEGORY_MAP[plaque.milestone_type];
  const catMeta = cat ? CATEGORY_META[cat] : null;
  return (
    <motion.button
      type="button"
      onClick={onClick}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(delay, 0.25), duration: 0.3 }}
      className="group relative text-left rounded-md overflow-hidden border border-border/60 bg-card/95 hover:border-primary/50 hover:shadow-[0_8px_30px_hsl(168_80%_50%/0.12)] transition-all"
    >
      <div className="aspect-[3/4] relative bg-white dark:bg-card overflow-hidden">
        {img ? (
          <img
            src={img}
            alt={plaque.badge_label || plaque.milestone_type}
            loading="lazy"
            className="w-full h-full object-cover transition-base group-hover:scale-[1.05]"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground/30">
            <Trophy className="h-16 w-16" />
          </div>
        )}
        {catMeta && (
          <div className="absolute top-2 left-2">
            <Badge variant="outline" className={cn("text-[11px] gap-1", catMeta.chipClass, "")}>
              <catMeta.icon className="h-2.5 w-2.5" /> {catMeta.label}
            </Badge>
          </div>
        )}
        <div className="absolute inset-x-0 bottom-0 h-1/3 bg-white dark:bg-card" />
      </div>
      <div className="p-2.5 space-y-1">
        <div className="flex items-center gap-2 min-w-0">
          {plaque.agent_photo ? (
            <img src={plaque.agent_photo} alt="" className="h-6 w-6 rounded-full object-cover ring-1 ring-border" />
          ) : (
            <div className="h-6 w-6 rounded-full bg-primary/15 text-primary text-[11px] font-bold flex items-center justify-center">
              {plaque.agent_name.split(" ").map((s) => s[0]).slice(0, 2).join("")}
            </div>
          )}
          <p className="font-semibold text-sm truncate">{plaque.agent_name}</p>
        </div>
        <p className="text-[12px] text-muted-foreground truncate">
          {plaque.badge_label || prettyMilestone(plaque.milestone_type)}
        </p>
        <p className="text-sm font-semibold tabular-nums">{metric.value ?? metric.missingText}</p>
        <p className="text-xs text-muted-foreground">{metric.label}</p>
        <p className="text-xs text-muted-foreground">
          {milestoneDate.label}: {milestoneDate.value}
        </p>
        {img && <p className="text-xs text-muted-foreground">Original artwork</p>}
      </div>
    </motion.button>
  );
}

interface PlaqueDetailProps { plaque: Plaque; onClose: () => void; }

/**
 * Build the public share URL for a plaque.
 *
 * Returns null when the plaque has no share_slug yet (created before the
 * slug backfill). The public share page resolves by share_slug, NOT plaque.id
 * — falling back to plaque.id would render "Plaque not found" for the recipient.
 * Exported for testing so the slug-vs-id contract can be pinned by a unit test.
 */
export function buildPlaqueShareUrl(
  plaque: Pick<Plaque, "share_slug">,
  origin = typeof window !== "undefined" ? window.location.origin : "",
): string | null {
  if (!plaque.share_slug) return null;
  return `${origin}/plaque/${plaque.share_slug}`;
}

function PlaqueDetail({ plaque, onClose }: PlaqueDetailProps) {
  const img = plaque.image_png_url || plaque.image_svg_url || plaque.custom_photo_url;
  const metric = presentPlaqueMetric(plaque);
  const milestoneDate = presentPlaqueDate({ ...plaque, milestone_date: plaque.milestone_date ?? "" });
  const cat = CATEGORY_MAP[plaque.milestone_type];
  const catMeta = cat ? CATEGORY_META[cat] : null;
  // Truthful fallback when clipboard is unavailable: reveal the URL in a
  // read-only input the user can select manually or long-press to share.
  // The prior copy said "select the URL manually" while rendering no URL.
  const [manualShareUrl, setManualShareUrl] = useState<string | null>(null);
  const manualShareInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!manualShareUrl) return;
    const el = manualShareInputRef.current;
    if (!el) return;
    el.focus();
    try {
      el.select();
    } catch { /* empty-catch-allow:select-unavailable */ }
  }, [manualShareUrl]);

  async function share() {
    // /plaque/:slug resolves by share_slug, not plaque.id — see PlaqueShare.tsx.
    // If a plaque was created before the slug backfill, there's nothing to
    // share yet; surface that honestly instead of copying a broken URL.
    const url = buildPlaqueShareUrl(plaque);
    if (!url) {
      toast.error("This plaque doesn't have a public share link yet.");
      return;
    }

    // Prefer navigator.share on mobile — hands the OS share sheet the URL
    // directly, which is faster than clipboard-then-paste.
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share({
          title: plaque.badge_label || "Galaxy Plaque",
          text: `${plaque.agent_name} · ${plaque.badge_label ?? prettyMilestone(plaque.milestone_type)}`,
          url,
        });
        return;
      } catch { // empty-catch-allow:navigator-share-cancelled
        // User cancelled or share failed — fall through to clipboard path.
      }
    }

    try {
      await navigator.clipboard.writeText(url);
      toast.success("Plaque link copied to clipboard");
      setManualShareUrl(null);
    } catch {
      // Copy failed. Show the URL so the user can actually select it,
      // instead of telling them to select something invisible.
      setManualShareUrl(url);
    }
  }

  return (
    <div className="flex flex-col">
      <div className="aspect-[3/4] sm:aspect-square relative bg-white dark:bg-card">
        {img ? (
          <img src={img} alt={plaque.badge_label ?? plaque.milestone_type} className="w-full h-full object-cover" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground/40">
            <Trophy className="h-32 w-32" />
          </div>
        )}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 h-9 w-9 rounded-full bg-black/40 text-white flex items-center justify-center hover:bg-black/60 transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
        {catMeta && (
          <div className="absolute top-3 left-3">
            <Badge variant="outline" className={cn("text-xs gap-1 ", catMeta.chipClass)}>
              <catMeta.icon className="h-3 w-3" /> {catMeta.label}
            </Badge>
          </div>
        )}
      </div>
      <div className="p-5 space-y-3">
        <div className="flex items-center gap-3">
          {plaque.agent_photo ? (
            <img src={plaque.agent_photo} alt="" className="h-12 w-12 rounded-full object-cover ring-2 ring-primary/40" />
          ) : (
            <div className="h-12 w-12 rounded-full bg-primary/15 text-primary font-bold flex items-center justify-center">
              {plaque.agent_name.split(" ").map((s) => s[0]).slice(0, 2).join("")}
            </div>
          )}
          <div>
            <p className="font-bold text-lg">{plaque.agent_name}</p>
            <p className="text-xs text-muted-foreground">
              {plaque.awarded_at ? `Awarded ${format(new Date(plaque.awarded_at), "PPP")}` : "Award date unavailable"}
            </p>
          </div>
        </div>
        <div>
          <p className="font-semibold text-xl">{plaque.badge_label || prettyMilestone(plaque.milestone_type)}</p>
          <p className="text-sm text-muted-foreground mt-1">{metric.label}</p>
          <p className="text-2xl font-bold text-emerald-500 dark:text-emerald-400 tabular-nums mt-0.5">
            {metric.value ?? metric.missingText}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {milestoneDate.label}: {milestoneDate.value}
          </p>
          {img && <p className="text-xs text-muted-foreground mt-1">Original artwork</p>}
        </div>
        <div className="flex items-center gap-2 pt-2 border-t border-border/40">
          <Button variant="outline" size="sm" onClick={share} className="flex-1">
            <Share2 className="h-4 w-4 mr-1.5" /> Share
          </Button>
          <Button variant="ghost" size="sm" onClick={() => {
            navigator.clipboard.writeText(plaque.id);
            toast.success("Plaque ID copied");
          }}>
            <Copy className="h-4 w-4 mr-1.5" /> ID
          </Button>
        </div>
        {manualShareUrl && (
          <div className="pt-2 space-y-1.5">
            <p className="text-xs text-muted-foreground">
              Clipboard blocked. Select and copy this link manually:
            </p>
            <Input
              ref={manualShareInputRef}
              readOnly
              value={manualShareUrl}
              onFocus={(e) => e.currentTarget.select()}
              aria-label="Plaque share URL"
              className="text-xs font-mono"
              data-testid="plaque-manual-share-url"
            />
          </div>
        )}
      </div>
    </div>
  );
}
