/**
 * MyPlaques — revamped. Reads from BOTH sources:
 *   - public.agentlink_rewards  (auto-issued nightly from leaderboard)
 *   - public.plaques            (manually generated historical PNGs)
 * Renders each with the unified <Plaque /> component. One grid, sorted
 * by date, share buttons per card. Admins see everyone; agents see
 * their own.
 */

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Award, Loader2, Crown, Medal, Trophy, Copy } from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { Plaque } from "@/components/plaque/Plaque";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Card = {
  id: string;
  source: "reward" | "plaque";
  agentName: string;
  avatarUrl?: string | null;
  achievement: string;
  rank?: number;
  subtitle?: string;
  date: string;
  dateIso: string;
  imageUrl?: string | null;
  shareSlug?: string | null;
};

export default function MyPlaques() {
  const { user, isAdmin, isManager } = useAuth();
  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState<"mine" | "all">(isAdmin || isManager ? "all" : "mine");

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        let myAgentId: string | null = null;
        if (scope === "mine" && user?.id) {
          const { data: a } = await supabase.from("agents").select("id").eq("user_id", user.id)
            .order("created_at", { ascending: false }).limit(1).maybeSingle();
          myAgentId = (a as any)?.id ?? null;
        }

        const rewardsQ = supabase.from("agentlink_rewards" as any)
          .select("id, agent_id, period, period_key, rank, title, description, alp, awarded_at");
        // Table is `plaque_awards` (not `plaques`). This was silently
        // returning 0 rows before — every agent saw an empty screen.
        // Also pulling image_svg_url as fallback since most rows have
        // only SVG populated.
        const plaquesQ = supabase.from("plaque_awards" as any)
          .select("id, agent_id, milestone_type, milestone_date, amount, image_png_url, image_svg_url, share_slug, badge_label, created_at")
          .order("created_at", { ascending: false }).limit(100);

        const [rewardsRes, plaquesRes] = await Promise.all([
          scope === "mine" && myAgentId ? rewardsQ.eq("agent_id", myAgentId) : rewardsQ,
          scope === "mine" && myAgentId ? plaquesQ.eq("agent_id", myAgentId) : plaquesQ,
        ]);

        const ids = new Set<string>();
        [...((rewardsRes as any).data ?? []), ...((plaquesRes as any).data ?? [])].forEach((r: any) => {
          if (r.agent_id) ids.add(r.agent_id);
        });
        const { data: agents } = await supabase.from("agents")
          .select("id, profile:profiles(full_name, avatar_url)")
          .in("id", Array.from(ids));
        const byId = new Map((agents ?? []).map((a: any) => [a.id, a.profile]));

        const rewardCards: Card[] = ((rewardsRes as any).data ?? []).map((r: any) => ({
          id: `reward-${r.id}`,
          source: "reward",
          agentName: (byId.get(r.agent_id) as any)?.full_name ?? "Unknown",
          avatarUrl: (byId.get(r.agent_id) as any)?.avatar_url ?? null,
          achievement: r.title,
          rank: r.rank,
          subtitle: r.alp ? `$${Number(r.alp).toLocaleString()} ALP` : r.description,
          date: new Date(r.awarded_at).toLocaleDateString(),
          dateIso: r.awarded_at,
        }));

        const plaqueCards: Card[] = ((plaquesRes as any).data ?? []).map((p: any) => ({
          id: `plaque-${p.id}`,
          source: "plaque",
          agentName: (byId.get(p.agent_id) as any)?.full_name ?? "Unknown",
          avatarUrl: (byId.get(p.agent_id) as any)?.avatar_url ?? null,
          achievement: p.badge_label || p.milestone_type.replace(/_/g, " "),
          subtitle: p.amount ? `$${Number(p.amount).toLocaleString()}` : undefined,
          date: p.milestone_date ? new Date(p.milestone_date).toLocaleDateString()
                                 : new Date(p.created_at).toLocaleDateString(),
          dateIso: p.milestone_date || p.created_at,
          imageUrl: p.image_png_url || p.image_svg_url,  // SVG data-URI fallback
          shareSlug: p.share_slug,
        }));

        const combined = [...rewardCards, ...plaqueCards].sort(
          (a, b) => new Date(b.dateIso).getTime() - new Date(a.dateIso).getTime()
        );
        setCards(combined);
      } finally { setLoading(false); }
    })();
  }, [scope, user?.id]);

  const copyShare = async (slug: string) => {
    const url = `${window.location.origin}/plaque/${slug}`;
    try { await navigator.clipboard.writeText(url); toast.success("Link copied"); }
    catch { toast.error("Copy failed — select the URL manually"); }
  };

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-4">
      <PageHeader
        accent="amber"
        eyebrow="Production · Recognition"
        eyebrowIcon={<Award className="h-3 w-3" />}
        title="My Plaques"
        subtitle="Every auto-issued leaderboard reward plus every manually generated plaque, in one grid. Share any card."
        actions={
          (isAdmin || isManager) && (
            <div className="flex gap-1 bg-muted/20 rounded-lg p-1">
              <Button size="sm" variant={scope === "mine" ? "default" : "ghost"} onClick={() => setScope("mine")}>Mine</Button>
              <Button size="sm" variant={scope === "all"  ? "default" : "ghost"} onClick={() => setScope("all")}>All agents</Button>
            </div>
          )
        }
      />

      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading plaques…
        </div>
      ) : cards.length === 0 ? (
        <GlassCard className="p-12 text-center space-y-3">
          <Trophy className="h-12 w-12 mx-auto text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No plaques yet. Win something — the system auto-generates them nightly from the leaderboard.
          </p>
        </GlassCard>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {cards.map(c => (
            <div key={c.id} className="space-y-2 group">
              {c.imageUrl ? (
                <img src={c.imageUrl} alt={c.achievement} className="w-full rounded-2xl shadow-2xl" />
              ) : (
                <div className="w-full overflow-hidden rounded-2xl shadow-2xl group-hover:scale-[1.01] transition-transform">
                  <Plaque
                    agentName={c.agentName}
                    achievement={c.achievement}
                    date={c.date}
                    rank={c.rank}
                    subtitle={c.subtitle}
                    avatarUrl={c.avatarUrl}
                    width={640} height={360}
                  />
                </div>
              )}
              <div className="flex items-center gap-2 px-1">
                <Badge variant="outline" className="text-[10px]">
                  {c.source === "reward" ? "Auto award" : "Custom plaque"}
                </Badge>
                {c.rank && c.rank <= 3 && (
                  <Badge variant="outline" className={cn(
                    "text-[10px]",
                    c.rank === 1 && "border-amber-400 text-amber-400",
                    c.rank === 2 && "border-slate-300 text-slate-600 dark:text-slate-300",
                    c.rank === 3 && "border-orange-400 text-orange-400"
                  )}>
                    {c.rank === 1 ? <Crown className="h-3 w-3 mr-1 inline" /> : <Medal className="h-3 w-3 mr-1 inline" />}
                    Rank #{c.rank}
                  </Badge>
                )}
                <div className="flex-1" />
                {c.shareSlug && (
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => copyShare(c.shareSlug!)}>
                    <Copy className="h-3 w-3 mr-1" /> Share
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
